import { NextResponse } from 'next/server'
import { mockLightningAddressData } from '@/mocks/lightning-address'

// Helper to ensure dates are parsed
const parseDates = (address: any) => ({
  ...address,
  createdAt: new Date(address.createdAt)
})

export async function GET() {
  const addresses = mockLightningAddressData.map(parseDates)
  return NextResponse.json(addresses)
}
