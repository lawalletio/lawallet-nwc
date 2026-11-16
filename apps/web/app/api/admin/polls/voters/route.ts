import { NextResponse } from 'next/server'
import { nip19 } from 'nostr-tools'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { validateQuery } from '@/lib/validation/middleware'
import { pollVotersQuerySchema } from '@/lib/validation/schemas'
import { resolveAddressDomain } from '@/lib/public-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/admin/polls/voters — users who answered the most polls, most
 * active first (ties: most recent vote), dismissed ones included and flagged.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithRole(request, Role.ADMIN)
  const { page, pageSize } = validateQuery(request.url, pollVotersQuerySchema)

  const [groups, total, domain] = await Promise.all([
    prisma.pollResponse.groupBy({
      by: ['userId'],
      _count: { _all: true },
      _max: { updatedAt: true },
      orderBy: [
        { _count: { userId: 'desc' } },
        { _max: { updatedAt: 'desc' } },
        { userId: 'asc' }
      ],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.user.count({ where: { pollResponses: { some: {} } } }),
    resolveAddressDomain(request)
  ])

  const users = await prisma.user.findMany({
    where: { id: { in: groups.map(g => g.userId) } },
    select: {
      id: true,
      pubkey: true,
      pollsDismissedAt: true,
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        select: { username: true }
      }
    }
  })
  const byId = new Map(users.map(u => [u.id, u]))

  const items = groups.flatMap(g => {
    const user = byId.get(g.userId)
    if (!user) return []
    const username = user.lightningAddresses[0]?.username
    return [
      {
        userId: user.id,
        ...(username ? { lightningAddress: `${username}@${domain}` } : {}),
        npub: nip19.npubEncode(user.pubkey),
        responseCount: g._count._all,
        lastVoteAt: g._max.updatedAt?.toISOString() ?? null,
        ...(user.pollsDismissedAt ? { dismissed: true } : {})
      }
    ]
  })

  return NextResponse.json({ items, total, page, pageSize })
})
