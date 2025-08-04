import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
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
