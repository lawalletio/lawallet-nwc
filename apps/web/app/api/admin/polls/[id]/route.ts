import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  idParam,
  pollShapeError,
  updatePollSchema,
  type PollOption
} from '@/lib/validation/schemas'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { serializePoll } from '@/lib/polls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

async function loadPoll(id: string) {
  const poll = await prisma.poll.findUnique({
    where: { id },
    include: { _count: { select: { responses: true } } }
  })
  if (!poll) throw new NotFoundError('Poll not found')
  return poll
}

/** GET /api/admin/polls/{id} */
export const GET = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await authenticateWithRole(request, Role.ADMIN)
  const { id } = validateParams(await ctx.params, idParam)
  const poll = await loadPoll(id)
  return NextResponse.json({
    ...serializePoll(poll),
    responseCount: poll._count.responses
  })
})

/**
 * PATCH /api/admin/polls/{id} — edit, publish (`status: OPEN`) or close.
 * Once a poll has responses its type and option ids are frozen; labels can
 * still be fixed.
 */
export const PATCH = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await checkRequestLimits(request, 'json')
  await authenticateWithRole(request, Role.ADMIN)
  const { id } = validateParams(await ctx.params, idParam)
  const data = await validateBody(request, updatePollSchema)
  const poll = await loadPoll(id)

  const shapeError = pollShapeError(
    data.type ?? poll.type,
    data.options ?? (poll.options as PollOption[])
  )
  if (shapeError) throw new ValidationError(shapeError)

  if (poll._count.responses > 0) {
    const ids = (options: PollOption[]) =>
      options
        .map(o => o.id)
        .sort()
        .join('\n')
    if (
      (data.type && data.type !== poll.type) ||
      (data.options && ids(data.options) !== ids(poll.options as PollOption[]))
    ) {
      throw new ConflictError(
        'Type and options cannot change once a poll has responses'
      )
    }
  }

  const updated = await prisma.poll.update({ where: { id }, data })
  return NextResponse.json({
    ...serializePoll(updated),
    responseCount: poll._count.responses
  })
})

/** DELETE /api/admin/polls/{id} — removes the poll and its responses. */
export const DELETE = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await authenticateWithRole(request, Role.ADMIN)
  const { id } = validateParams(await ctx.params, idParam)
  await loadPoll(id)
  await prisma.poll.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
