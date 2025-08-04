import { NextResponse } from 'next/server'
import { mockLightningAddressData } from '@/mocks/lightning-address'

export async function GET() {
  const counts = {
    total: mockLightningAddressData.length,
    withNWC: mockLightningAddressData.filter(addr => addr.nwc !== undefined)
      .length,
    withoutNWC: mockLightningAddressData.filter(addr => addr.nwc === undefined)
      .length
  }

  return NextResponse.json(counts)
}
