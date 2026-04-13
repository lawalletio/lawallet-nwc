import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { LightningAddress } from '@/types/lightning-address'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await validateAdminAuth(request)
  const addresses = await prisma.lightningAddress.findMany({
    select: {
      username: true,
      createdAt: true,
      user: {
        select: {
          pubkey: true,
          nwc: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  // Transform to match LightningAddress type
  const transformedAddresses: LightningAddress[] = addresses.map(address => ({
    username: address.username,
    pubkey: address.user.pubkey,
    createdAt: address.createdAt,
    nwc: address.user.nwc || undefined
  }))

  return NextResponse.json(transformedAddresses)
})
