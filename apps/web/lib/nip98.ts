import { nip98, NostrEvent } from 'nostr-tools'
import { resolveApiUrl } from '@/lib/public-url'

/**
 * Server-side NIP-98 token validation.
 *
 * This module is server-only: it resolves the instance's public URL from
 * DB-backed settings, so it must never be imported by client components. The
 * browser-safe token *creation* helpers live in `@/lib/nip98-client`.
 */

/** Outcome of validating a NIP-98 token — the verified pubkey and the raw event. */
export interface Nip98ValidationResult {
  pubkey: string
  event: NostrEvent
}

/**
 * Validates a NIP-98 authentication token from a `Request`.
 *
 * The signed `u` tag commits to the *public* URL the client used, which is not
 * the internal one Next.js sees behind a proxy/tunnel. Reverse proxies (e.g.
 * Cloudflare Tunnel + Umbrel's app_proxy) frequently rewrite the `Host` header
 * to the internal origin and don't forward `x-forwarded-host`, so we anchor on
 * the admin-configured `endpoint` setting (this instance's true public URL) and
 * accept forwarded/host headers only as fallbacks.
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
  try {
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
