import { NextResponse, type NextRequest } from 'next/server'
import { getOpenApiDocument } from '@lawallet-nwc/openapi'
import { withErrorHandling } from '@/types/server/error-handler'

// Public: the spec is intentionally accessible without auth so the docs site,
// SDK generators, and any external consumer can fetch it.
//
// Server URL resolution (highest precedence wins):
//   1. `OPENAPI_SERVER_URL` env var — admin pin.
//   2. `?serverUrl=` query param — chosen at runtime by the docs UI's
//      navbar selector (or any external caller).
//   3. `x-forwarded-proto` + `x-forwarded-host` — handles tunnels and
//      reverse proxies.
//   4. Direct `host` header — normal local dev / direct deploys.
//
// Reading headers / search params forces dynamic rendering — fine since
// `getOpenApiDocument()` is cheap.
export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: NextRequest) => {
  const queryServerUrl = request.nextUrl.searchParams.get('serverUrl')?.trim() || null
  const serverUrl =
    process.env.OPENAPI_SERVER_URL ||
    (queryServerUrl && isSafeUrl(queryServerUrl) ? queryServerUrl : null) ||
    resolveServerUrl(request.headers)
  return NextResponse.json(getOpenApiDocument({ serverUrl }))
})

function resolveServerUrl(h: Headers): string {
  const proto = h.get('x-forwarded-proto') || 'http'
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

// Reject anything that isn't a plain http(s) URL so a malicious link can't
// embed `javascript:` or other URI schemes into the rendered docs.
function isSafeUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
