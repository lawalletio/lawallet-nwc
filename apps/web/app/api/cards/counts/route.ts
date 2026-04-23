import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARDS_READ)

  const [total, paired, unpaired, used, unused] = await Promise.all([
    prisma.card.count(),
    prisma.card.count({ where: { otc: { not: null } } }),
    prisma.card.count({ where: { otc: { equals: null } } }),
    prisma.card.count({ where: { lastUsedAt: { not: null } } }),
    prisma.card.count({ where: { lastUsedAt: { equals: null } } }),
  ])

  return NextResponse.json({ total, paired, unpaired, used, unused })
})
