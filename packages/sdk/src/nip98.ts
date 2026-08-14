import { getToken } from 'nostr-tools/nip98'
import type { NostrSigner } from './signer'

/**
 * NIP-98 token creation — every authenticated SDK request carries an
 * `Authorization: Nostr <base64-event>` header: a kind-27235 event signed by
 * the user's key committing to the exact URL, method and body of the request.
 */

/**
 * Normalises a request body into the plain object that NIP-98 hashes.
 * Non-JSON strings are wrapped as `{ body: '<string>' }` so the hash is stable.
 *
 * @returns The payload to feed to `getToken`, or `undefined` for empty bodies.
 */
export function bodyToPayload(
  body: unknown
): Record<string, unknown> | undefined {
  if (!body) return undefined

  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return { body }
    }
  }
  if (body instanceof FormData || body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries())
  }
  return body as Record<string, unknown>
}

/**
 * Creates a NIP-98 authorization header value for an HTTP request.
 *
 * @param url - The absolute public URL of the request (must match what the server sees)
 * @param requestInit - Method and body of the request
 * @param signer - Any {@link NostrSigner}
 * @returns The Authorization header value, `"Nostr <base64-event>"`
 */
export async function createNip98Token(
  url: string,
  requestInit: { method?: string; body?: unknown },
  signer: NostrSigner
): Promise<string> {
  const method = requestInit.method || 'GET'
  const payload = bodyToPayload(requestInit.body)

  return getToken(url, method, event => signer.signEvent(event), true, payload)
}

/**
 * Creates a bare base64 NIP-98 event (no `"Nostr "` prefix) for transports
 * that can't send headers — the `?token=` query param of `GET /api/events`.
 * The signed URL must not contain a query string: the token cannot commit to
 * a URL containing itself.
 */
export async function createNip98QueryToken(
  url: string,
  signer: NostrSigner
): Promise<string> {
  return getToken(url, 'GET', event => signer.signEvent(event), false)
}
