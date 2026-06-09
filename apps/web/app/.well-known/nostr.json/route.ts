import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: NextRequest) => {
  const name = request.nextUrl.searchParams.get('name')?.trim().toLowerCase()

  if (name === '_') {
    return NextResponse.json({ names: {} })
  }

  const where = name ? { username: name } : undefined
  const addresses = await prisma.lightningAddress.findMany({
    where,
    take: name ? 1 : 100,
    include: {
      user: {
        select: { pubkey: true },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })

  const names = Object.fromEntries(
    addresses.map(address => [address.username, address.user.pubkey]),
  )

  return NextResponse.json({ names })
})
