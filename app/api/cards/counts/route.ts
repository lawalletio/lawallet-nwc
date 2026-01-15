import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await validateAdminAuth(request)
  const [paired, unpaired, used, unused] = await Promise.all([
    prisma.card.count({
      where: { otc: { not: null } }
    }),
    prisma.card.count({
      where: { otc: { equals: null } }
    }),
    prisma.card.count({
      where: { lastUsedAt: { not: null } }
    }),
    prisma.card.count({
      where: { lastUsedAt: { equals: null } }
    })
  ])

  const statusCounts = {
    paired,
    unpaired,
    used,
    unused
  }

  return NextResponse.json(statusCounts)
})
