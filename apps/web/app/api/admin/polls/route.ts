import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { createPollSchema } from '@/lib/validation/schemas'
import { serializePoll } from '@/lib/polls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/admin/polls — every poll with its response count. */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithRole(request, Role.ADMIN)

  const polls = await prisma.poll.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      // Dismissed votes don't count; the freeze check in [id] still sees them.
      _count: { select: { responses: { where: { dismissedAt: null } } } },
      responses: {
        where: { dismissedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { updatedAt: true }
      }
    }
  })

  return NextResponse.json(
    polls.map(poll => ({
      ...serializePoll(poll),
      responseCount: poll._count.responses,
      lastResponseAt: poll.responses[0]?.updatedAt.toISOString() ?? null
    }))
  )
})

/** POST /api/admin/polls — create a poll (DRAFT unless `status` says otherwise). */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await authenticateWithRole(request, Role.ADMIN)
  const data = await validateBody(request, createPollSchema)

  const poll = await prisma.poll.create({ data })
  return NextResponse.json(
    { ...serializePoll(poll), responseCount: 0, lastResponseAt: null },
    { status: 201 }
  )
})
