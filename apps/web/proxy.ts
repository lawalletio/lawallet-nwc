import { NextRequest, NextResponse } from 'next/server'

/**
 * Cross-origin access for the REST API.
 *
 * Third-party apps (SDK consumers on their own origins) authenticate with
 * per-request NIP-98 events or Bearer tokens — pure Authorization-header auth,
 * no cookies — so a wildcard origin without credentials is the correct browser
 * security model here.
 *
 * Two classes of routes are deliberately skipped:
 * - /api/jwt: session-JWT minting stays a first-party, same-origin mechanism.
 *   Cross-origin callers must sign each request with NIP-98 instead.
 * - Routes that already ship their own public CORS headers (LUD-16 and the
 *   NTAG scan/write/wipe callbacks) — setting Access-Control-Allow-Origin
 *   twice makes browsers reject the response outright.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
} as const

const SELF_MANAGED_CORS = [
  /^\/api\/lud16(\/|$)/,
  /^\/api\/cards\/[^/]+\/(scan|write|wipe)(\/|$)/
]

const JWT_ROUTE = /^\/api\/jwt(\/|$)/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    JWT_ROUTE.test(pathname) ||
    SELF_MANAGED_CORS.some(re => re.test(pathname))
  ) {
    return NextResponse.next()
  }

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
  }

  const response = NextResponse.next()
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value)
  }
  return response
}

export const config = {
  matcher: '/api/:path*'
}
