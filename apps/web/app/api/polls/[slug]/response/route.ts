import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/generated/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  pollResponseBodySchema,
  pollSlugParam,
  type PollOption
} from '@/lib/validation/schemas'
import { ApiError, NotFoundError } from '@/types/server/errors'
import { validateChoices } from '@/lib/polls'

export const dynamic = 'force-dynamic'

const pollLocked = () =>
  new ApiError('You already answered this poll', {
    statusCode: 409,
    code: 'POLL_LOCKED'
  })

/**
 * PUT /api/polls/{slug}/response — submit (or, on an updatable poll, replace)
 * the caller's answer. A one-time poll rejects a second submit with
 * `POLL_LOCKED`; the (pollId, userId) unique key backs that under races.
 */
export const PUT = withErrorHandling(
  async (request: Request, context: { params: Promise<{ slug: string }> }) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { slug } = validateParams(await context.params, pollSlugParam)
    const body = await validateBody(request, pollResponseBodySchema)

    let updatable = true
    try {
      const response = await prisma.$transaction(async tx => {
        const poll = await tx.poll.findUnique({ where: { slug } })
        if (!poll || poll.status === 'DRAFT') {
          throw new NotFoundError('Poll not found')
        }
        if (poll.status !== 'OPEN') {
          throw new ApiError('This poll is closed', {
            statusCode: 409,
            code: 'POLL_CLOSED'
          })
        }
        const choices = validateChoices(
          { ...poll, options: poll.options as PollOption[] },
          body.choices
        )
        updatable = poll.updatable
        const key = { pollId_userId: { pollId: poll.id, userId } }

        if (!poll.updatable) {
          if (await tx.pollResponse.findUnique({ where: key })) {
            throw pollLocked()
          }
          return tx.pollResponse.create({
            data: { pollId: poll.id, userId, choices }
          })
        }
        return tx.pollResponse.upsert({
          where: key,
          create: { pollId: poll.id, userId, choices },
          update: { choices }
        })
      })

      return NextResponse.json({
        response: {
          choices: response.choices as string[],
          updatedAt: response.updatedAt.toISOString()
        }
      })
    } catch (error) {
      // A concurrent first submit won the unique key.
      if (
        !updatable &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw pollLocked()
      }
      throw error
    }
  }
)
