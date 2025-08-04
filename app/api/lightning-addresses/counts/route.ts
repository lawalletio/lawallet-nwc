import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const [total, withNWC, withoutNWC] = await Promise.all([
    prisma.lightningAddress.count(),
    prisma.lightningAddress.count({
      where: {
        user: {
          nwc: { not: null }
        }
      }
    }),
    prisma.lightningAddress.count({
      where: {
        user: {
          nwc: null
        }
      }
    })
  ])

  return NextResponse.json({
    total,
    withNWC,
    withoutNWC
  })
}
