import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  const addresses = await prisma.lightningAddress.findMany({
    select: {
      username: true,
      createdAt: true,
      user: {
        select: {
          pubkey: true,
          nwc: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  const transformed = addresses.map(address => ({
    username: address.username,
    pubkey: address.user.pubkey,
    nwcString: address.user.nwc || null,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.createdAt.toISOString(),
  }))

  return NextResponse.json(transformed)
})
