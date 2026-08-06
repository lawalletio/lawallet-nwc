import { NextResponse } from 'next/server'

/**
 * CORS contract for public discovery/payment endpoints.
 *
 * NIP-05 and LNURL are intentionally unauthenticated protocols. Browser-based
 * wallets and Nostr clients must be able to resolve them from any origin.
 */
export const PUBLIC_READ_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
} as const

export const publicReadOptions = () =>
  new NextResponse(null, {
    status: 204,
    headers: PUBLIC_READ_CORS_HEADERS
  })

/** Add public CORS headers to every successful response from a route handler. */
export function withPublicReadCors<
  TArgs extends unknown[],
  TResponse extends Response
>(handler: (...args: TArgs) => Promise<TResponse>) {
  return async (...args: TArgs): Promise<TResponse> => {
    const response = await handler(...args)
    for (const [name, value] of Object.entries(PUBLIC_READ_CORS_HEADERS)) {
      response.headers.set(name, value)
    }
    return response
  }
}
