import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/users
 *
 * Admin list (gated by USERS_READ): one row per User. Returns the core
 * identity fields plus a summary of the user's primary lightning address
 * and total address count, so the /admin/users table can render without
 * a second per-row fetch.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.USERS_READ)

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        select: { username: true },
      },
      _count: {
        select: { lightningAddresses: true, nwcConnections: true },
      },
    },
  })

  const transformed = users.map(user => ({
    id: user.id,
    pubkey: user.pubkey,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    primaryAddress: user.lightningAddresses[0]?.username ?? null,
    addressCount: user._count.lightningAddresses,
    hasNwc: user._count.nwcConnections > 0 || !!user.nwc,
  }))

  return NextResponse.json(transformed)
})
