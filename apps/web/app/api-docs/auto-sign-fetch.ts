import type { NostrSigner } from '@nostrify/nostrify'
import { createNip98Token } from '@/lib/nip98-client'
import { normalizeRequest, shouldAutoSign } from './normalize-request'

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

/**
 * Wrap `fetch` so NIP-98 routes get a freshly signed `Authorization: Nostr …`
 * header and the original body is re-issued intact.
 *
 * Scalar's browser "Try it out" calls `fetch(new Request(url, { body }))`.
 * Request bodies are one-shot, so `normalizeRequest` clones before reading
 * and this wrapper must pass `req.realBody` through — dropping it made
 * `validateBody` throw `SyntaxError` → HTTP 500.
 */
export function createAutoSignFetch(
  originalFetch: FetchFn,
  nip98Routes: Set<string>,
  signer: NostrSigner
): FetchFn {
  return async (input, init) => {
    try {
      const req = await normalizeRequest(input, init)
      if (req && shouldAutoSign(req, nip98Routes)) {
        const signed = await createNip98Token(
          req.url,
          { method: req.method, body: req.bodyForHash },
          signer
        )
        req.headers.set('Authorization', signed)
        return originalFetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.realBody
        })
      }
    } catch {
      // Fall through to the original fetch — never fail the user's request
      // just because our auto-sign helper threw.
    }
    return originalFetch(input as RequestInfo, init)
  }
}
