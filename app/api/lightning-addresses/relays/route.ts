import { NextResponse } from 'next/server'
import { mockLightningAddressData } from '@/mocks/lightning-address'

export async function GET() {
  const relays = new Set<string>()

  mockLightningAddressData.forEach(addr => {
    if (addr.nwc) {
      try {
        const url = new URL(addr.nwc)
        const relayParam = url.searchParams.get('relay')
        if (relayParam) {
          relays.add(decodeURIComponent(relayParam))
        }
      } catch (error) {
        // Skip invalid URLs
      }
    }
  })

  return NextResponse.json(Array.from(relays))
}
