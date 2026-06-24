import { NostrSigner } from '@nostrify/nostrify'
import { nip98, NostrEvent } from 'nostr-tools'
import { getToken } from 'nostr-tools/nip98'

/** Outcome of validating a NIP-98 token — the verified pubkey and the raw event. */
export interface Nip98ValidationResult {
  pubkey: string
  event: NostrEvent
}

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
 * @param requestInit - The RequestInit object containing method, body, and URL
 * @param signer - Object with signEvent method to sign the NIP-98 event
 * @param url - The absolute URL for the request
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

/**
 * Validates a NIP-98 authentication token from a `Request`.
 *
 * The signed event commits to the *public* URL the client typed, not the
 * internal one Next.js sees behind a proxy/tunnel. We reconstruct that URL
 * from `x-forwarded-host` / `x-forwarded-proto` (falling back to `host` and
 * the request scheme) so signatures verify in development tunnels and
 * production proxies alike.
 *
 * @param request - The incoming HTTP request
 * @param timeDelta - Allowed clock skew in seconds for the event's `created_at`
 * @returns The verified pubkey and full event
 * @throws {Error} On missing/malformed header, signature mismatch, or stale timestamp.
 */
export async function validateNip98(
  request: Request,
  timeDelta: number = 60
): Promise<Nip98ValidationResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    throw new Error('Authorization header is required')
  }

  if (!authHeader.startsWith('Nostr ')) {
    throw new Error('Authorization header must start with "Nostr "')
  }

  const base64Event = authHeader.substring(6) // Remove "Nostr " prefix

  if (!base64Event) {
    throw new Error('Event data is required')
  }

  let event: NostrEvent
  try {
    const eventData = atob(base64Event)
    event = JSON.parse(eventData)
  } catch (error) {
    console.error('Failed to parse event:', error)
    throw new Error('Invalid event format')
  }

  // The signed `u` tag commits to the *public* URL the client used, which is
  // not the internal one Next.js sees behind a proxy/tunnel. Reverse proxies
  // (e.g. Cloudflare Tunnel + Umbrel's app_proxy) frequently rewrite the `Host`
  // header to the internal origin and don't forward `x-forwarded-host`, so we
  // anchor on the admin-configured `endpoint` setting (this instance's true
  // public URL) and accept forwarded/host headers only as fallbacks.
  const originalUrl = new URL(request.url)
  const pathAndQuery = originalUrl.pathname + originalUrl.search

  const origins = new Set<string>()

  // 1. Admin-configured public endpoint — authoritative behind proxies/tunnels.
  //    Dynamically imported so this server-only path never pulls DB code into
  //    client bundles that use the token-creation helpers above.
  try {
    const { resolveApiUrl } = await import('@/lib/public-url')
    const apiUrl = await resolveApiUrl(request)
    if (apiUrl) origins.add(apiUrl)
  } catch {
    // Settings unavailable (e.g. fresh install or unit context) — fall back to
    // the request headers below.
  }

  // 2. Headers set by a reverse proxy that forwards the original host.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    origins.add(`${forwardedProto || 'https'}://${forwardedHost}`)
  }

  // 3. The raw `Host` header / the URL Next.js actually received.
  const host = request.headers.get('host')
  if (host) {
    const protocol =
      forwardedProto || (request.url.startsWith('https') ? 'https' : 'http')
    origins.add(`${protocol}://${host}`)
  }
  origins.add(originalUrl.origin)

  // The `u` tag must equal one of the candidate public URLs. Pick the matching
  // one so nostr-tools validates against it; otherwise fall back to the first
  // candidate so the resulting error message stays meaningful.
  const uTag = event.tags.find(tag => tag[0] === 'u')?.[1]
  const candidateUrls = Array.from(origins, origin =>
    new URL(pathAndQuery, origin).toString()
  )
  const publicUrl =
    candidateUrls.find(candidate => candidate === uTag) ?? candidateUrls[0]

  const method = request.method

  try {
    const requestBody = await request.clone().text()

    const isValid = await nip98.validateEvent(
      event,
      publicUrl,
      method,
      requestBody
    )

    if (!isValid) {
      throw new Error('Event validation failed')
    }
  } catch (error) {
    console.error('Event validation error:', error)
    throw new Error(
      `Event validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Check if created_at is within reasonable time window (default 60 seconds)
  const now = Math.floor(Date.now() / 1000)
  const eventTime = event.created_at
  const timeDiff = Math.abs(now - eventTime)

  if (timeDiff > timeDelta) {
    throw new Error(
      `Event timestamp is too old or too new (must be within ${timeDelta} seconds)`
    )
  }

  const result = {
    pubkey: event.pubkey,
    event: event
  }
  return result
}
