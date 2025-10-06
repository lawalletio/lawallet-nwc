import { NextResponse } from 'next/server'
import { mockLightningAddressData } from '@/mocks/lightning-address'
import { validateAdminAuth } from '@/lib/admin-auth'

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
