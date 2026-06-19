import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARDS_READ)

  // "Paired" === the card has an owner. `userId` is the authoritative holder
  // field (set on activation/claim); `otc` is unrelated (every card is minted
  // with one), so counting by it was wrong.
  const [total, paired, unpaired, used, unused, blocked] = await Promise.all([
    prisma.card.count(),
    prisma.card.count({ where: { userId: { not: null } } }),
    prisma.card.count({ where: { userId: { equals: null } } }),
    prisma.card.count({ where: { lastUsedAt: { not: null } } }),
    prisma.card.count({ where: { lastUsedAt: { equals: null } } }),
    // "Blocked" === reset keys exported (decommissioned, pending delete).
    prisma.card.count({ where: { blockedAt: { not: null } } }),
  ])

  return NextResponse.json({ total, paired, unpaired, used, unused, blocked })
})
