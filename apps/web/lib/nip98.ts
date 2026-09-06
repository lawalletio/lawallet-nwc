import { createHash } from 'node:crypto'
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

function decodeNip98Token(base64Event: string): NostrEvent {
  if (!base64Event) {
    throw new Error('Event data is required')
  }

  try {
    return JSON.parse(atob(base64Event))
  } catch (error) {
    console.error('Failed to parse event:', error)
    throw new Error('Invalid event format')
  }
}

/**
 * Candidate public origins for the signed `u` tag.
 *
 * The signed `u` tag commits to the *public* URL the client used, which is not
 * the internal one Next.js sees behind a proxy/tunnel. Reverse proxies (e.g.
 * Cloudflare Tunnel + Umbrel's app_proxy) frequently rewrite the `Host` header
 * to the internal origin and don't forward `x-forwarded-host`, so we anchor on
 * the admin-configured `endpoint` setting (this instance's true public URL) and
 * accept forwarded/host headers only as fallbacks.
 */
async function resolveCandidateOrigins(request: Request): Promise<Set<string>> {
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
  origins.add(new URL(request.url).origin)

  return origins
}

/**
 * Bind the signature to the request body.
 *
 * nostr-tools' `validateEvent` only checks the `payload` tag when its `body`
 * argument is a **non-empty object**, and we hand it the raw body as a
 * *string* — so that check never ran. The signature therefore covered the URL,
 * the method and the timestamp, but not a single byte of what was being
 * asked for. Inside the ±60s window a captured `Authorization` header could
 * be replayed against the same endpoint carrying a completely different body,
 * under the original signer's identity.
 *
 * That matters wherever a route makes a decision from the body while trusting
 * the signer: `POST /api/vouchers` gates on the recipient's sender allowlist,
 * so an unbound body means an allowlisted service's token can be replayed to
 * deposit to somebody else entirely.
 *
 * So the hash is computed here over the exact bytes received, and the tag is
 * **required** for any request that carries a body. NIP-98 says the tag SHOULD
 * be present when there is one; accepting its absence is the same as not
 * checking. Our own SDK already signs it (`packages/sdk/src/nip98.ts`), and
 * empty-body requests are unaffected.
 */
function assertPayloadBinding(event: NostrEvent, requestBody: string): void {
  if (!requestBody) return

  const payloadTag = event.tags.find(tag => tag[0] === 'payload')?.[1]
  if (!payloadTag) {
    throw new Error(
      'Invalid nostr event, payload tag is required for requests with a body'
    )
  }

  const digest = createHash('sha256').update(requestBody, 'utf8').digest('hex')
  if (payloadTag.toLowerCase() !== digest) {
    throw new Error(
      'Invalid nostr event, payload tag does not match request body hash'
    )
  }
}

async function validateDecodedEvent(
  event: NostrEvent,
  request: Request,
  pathAndQuery: string,
  method: string,
  requestBody: string,
  timeDelta: number
): Promise<Nip98ValidationResult> {
  const origins = await resolveCandidateOrigins(request)

  // The `u` tag must equal one of the candidate public URLs. Pick the matching
  // one so nostr-tools validates against it; otherwise fall back to the first
  // candidate so the resulting error message stays meaningful.
  const uTag = event.tags.find(tag => tag[0] === 'u')?.[1]
  const candidateUrls = Array.from(origins, origin =>
    new URL(pathAndQuery, origin).toString()
  )
  const publicUrl =
    candidateUrls.find(candidate => candidate === uTag) ?? candidateUrls[0]

  try {
    const isValid = await nip98.validateEvent(
      event,
      publicUrl,
      method,
      requestBody
    )

    if (!isValid) {
      throw new Error('Event validation failed')
    }

    assertPayloadBinding(event, requestBody)
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

  return {
    pubkey: event.pubkey,
    event: event
  }
}

/**
 * Validates a NIP-98 authentication token from a `Request`'s
 * `Authorization: Nostr <base64-event>` header.
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

  const event = decodeNip98Token(authHeader.substring(6)) // Remove "Nostr " prefix

  const originalUrl = new URL(request.url)
  const requestBody = await request.clone().text()

  return validateDecodedEvent(
    event,
    request,
    originalUrl.pathname + originalUrl.search,
    request.method,
    requestBody,
    timeDelta
  )
}

/**
 * Validates a NIP-98 event carried in a query parameter instead of the
 * `Authorization` header — for `EventSource`, which cannot send headers.
 *
 * Because the token travels *inside* the query string, it cannot commit to a
 * URL containing itself: the signed `u` tag must be the request URL without
 * any query (e.g. `https://instance.example/api/events`), and the method is
 * always GET with no payload.
 *
 * @param request - The incoming HTTP request (used for public-URL resolution)
 * @param token - The base64-encoded kind-27235 event
 * @param timeDelta - Allowed clock skew in seconds for the event's `created_at`
 */
export async function validateNip98QueryToken(
  request: Request,
  token: string,
  timeDelta: number = 60
): Promise<Nip98ValidationResult> {
  const event = decodeNip98Token(token)

  return validateDecodedEvent(
    event,
    request,
    new URL(request.url).pathname,
    'GET',
    '',
    timeDelta
  )
}
