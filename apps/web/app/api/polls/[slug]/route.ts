import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { pollSlugParam } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { serializePoll } from '@/lib/polls'

export const dynamic = 'force-dynamic'

/** GET /api/polls/{slug} — a published poll plus the caller's response. */
export const GET = withErrorHandling(
  async (request: Request, context: { params: Promise<{ slug: string }> }) => {
    const userId = await requireUserId(request)
    const { slug } = validateParams(await context.params, pollSlugParam)

    const poll = await prisma.poll.findUnique({
      where: { slug },
      include: {
        responses: {
          where: { userId },
          select: { choices: true, updatedAt: true }
        }
      }
    })
    if (!poll || poll.status === 'DRAFT') {
      throw new NotFoundError('Poll not found')
    }

    const response = poll.responses[0]
    return NextResponse.json({
      poll: serializePoll(poll),
      response: response
        ? {
            choices: response.choices as string[],
            updatedAt: response.updatedAt.toISOString()
          }
        : null
    })
  }
)
