import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/config/env'

// Read at request time: Docker/Umbrel images are built without runtime env.
export const dynamic = 'force-dynamic'

/**
 * Apple App Site Association: lets the native iOS wallet use this instance's
 * passkeys (webcredentials) and open card-activation links in-app (applinks).
 * Opt-in per instance via APPLE_APP_IDS; 404 when unset.
 */
export function GET() {
  const apps = getEnv().APPLE_APP_IDS
  if (!apps.length) return new NextResponse(null, { status: 404 })

  return NextResponse.json({
    webcredentials: { apps },
    applinks: {
      details: [{ appIDs: apps, components: [{ '/': '/wallet/activate/*' }] }]
    }
  })
}
