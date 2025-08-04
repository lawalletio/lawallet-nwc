import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { LightningAddress } from '@/types/lightning-address'

export async function GET() {
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
