import { NostrSigner } from '@nostrify/nostrify'
import { getToken } from 'nostr-tools/nip98'

/**
 * Browser-safe NIP-98 helpers for *creating* authorization tokens.
 *
 * Kept separate from `@/lib/nip98` (which validates tokens server-side and
 * therefore pulls in DB-backed settings) so client bundles never drag server
 * code — and `prisma` — into the browser graph.
 */

/**
 * Generates an absolute URL considering the browser URL context
 * @param url - The URL to make absolute (can be relative or absolute)
 * @param baseUrl - Optional base URL (defaults to window.location.origin if in browser)
 * @returns string - The absolute URL
 */
export function generateAbsoluteUrl(url: string, baseUrl?: string): string {
  // If the URL is already absolute, return it as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Determine the base URL
  let base: string
  if (baseUrl) {
    base = baseUrl
  } else if (typeof window !== 'undefined') {
    // In browser environment, use current origin
    base = window.location.origin
  } else {
    // In server environment, you might want to use an environment variable
    // or throw an error if baseUrl is required
    throw new Error('baseUrl is required in server environment')
  }

  // Ensure base URL always ends with a slash
  if (!base.endsWith('/')) {
    base += '/'
  }

  // If URL starts with a slash, it's an absolute path
  if (url.startsWith('/')) {
    return base + url.substring(1)
  }

  // Otherwise, it's a relative path
  return base + url
}

/**
 * Normalises a `RequestInit.body` into the plain object that NIP-98 hashes.
 * Non-JSON strings are wrapped as `{ body: '<string>' }` so the hash is stable.
 *
 * @returns The payload to feed to `getToken`, or `undefined` for empty bodies.
 */
export function bodyToPayload(body: any): Record<string, any> | undefined {
  let payload: Record<string, any> | undefined
  if (body) {
    if (typeof body === 'string') {
      try {
        payload = JSON.parse(body)
      } catch {
        // If it's not JSON, use as string
        payload = { body }
      }
    } else if (body instanceof FormData) {
      // Convert FormData to object
      const formDataObj: Record<string, any> = {}
      for (const [key, value] of body.entries()) {
        formDataObj[key] = value
      }
      payload = formDataObj
    } else if (body instanceof URLSearchParams) {
      // Convert URLSearchParams to object
      const paramsObj: Record<string, any> = {}
      for (const [key, value] of body.entries()) {
        paramsObj[key] = value
      }
      payload = paramsObj
    } else {
      // For other body types, use as is
      payload = body as Record<string, any>
    }
  }
  return payload
}

/**
 * Creates a NIP-98 authorization token for HTTP requests
 * @param url - The absolute URL for the request
 * @param requestInit - The RequestInit object containing method, body, and URL
 * @param signer - Object with signEvent method to sign the NIP-98 event
 * @returns Promise<string> - The Authorization header value (e.g., "Nostr <base64-event>")
 */
export async function createNip98Token(
  url: string,
  requestInit: RequestInit,
  signer: NostrSigner
): Promise<string> {
  // Create the NIP-98 event using nostr-tools helper
  const method = requestInit.method || 'GET'

  // Get the request body for payload hash calculation
  const payload = bodyToPayload(requestInit.body)

  // Create the NIP-98 authorization token using nostr-tools
  const authHeader = await getToken(
    generateAbsoluteUrl(url),
    method,
    event => {
      return signer.signEvent(event)
    },
    true, // includePayloadHash
    payload
  )

  return authHeader
}
