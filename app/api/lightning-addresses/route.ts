import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { LightningAddress } from '@/types/lightning-address'
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
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
}
