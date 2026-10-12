import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type CountRow = Record<
  'total' | 'paired' | 'unpaired' | 'used' | 'unused' | 'blocked',
  bigint
>

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARDS_READ)

  // One table scan instead of six count() round trips.
  // "Paired" === the card has an owner. `userId` is the authoritative holder
  // field (set on activation/claim); `otc` is unrelated (every card is minted
  // with one), so counting by it was wrong.
  // "Blocked" === reset keys exported (decommissioned, pending delete).
  const [row] = await prisma.$queryRaw<CountRow[]>`
    SELECT count(*) AS "total",
           count(*) FILTER (WHERE "userId" IS NOT NULL) AS "paired",
           count(*) FILTER (WHERE "userId" IS NULL) AS "unpaired",
           count(*) FILTER (WHERE "lastUsedAt" IS NOT NULL) AS "used",
           count(*) FILTER (WHERE "lastUsedAt" IS NULL) AS "unused",
           count(*) FILTER (WHERE "blockedAt" IS NOT NULL) AS "blocked"
      FROM "Card"
  `

  return NextResponse.json({
    total: Number(row.total),
    paired: Number(row.paired),
    unpaired: Number(row.unpaired),
    used: Number(row.used),
    unused: Number(row.unused),
    blocked: Number(row.blocked)
  })
})
