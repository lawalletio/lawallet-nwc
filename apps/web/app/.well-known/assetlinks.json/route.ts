import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

/**
 * Digital Asset Links statement for the native Android wallet: lets the app
 * open this domain's links (App Links) and use its passkeys (Credential
 * Manager). `[]` until `ANDROID_APP_CERT_SHA256` is configured.
 */
export function GET() {
  const { packageName, certFingerprints } = getConfig().android
  if (!certFingerprints.length) return NextResponse.json([])

  return NextResponse.json([
    {
      relation: [
        'delegate_permission/common.get_login_creds',
        'delegate_permission/common.handle_all_urls'
      ],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: certFingerprints
      }
    }
  ])
}
