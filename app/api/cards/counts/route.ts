import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateAdminAuth } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    await validateAdminAuth(request)
  } catch (response) {
    if (response instanceof NextResponse) {
      return response
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
}
