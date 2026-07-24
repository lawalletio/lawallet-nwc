/**
 * Recognizes card **activation URLs** the wallet scanner may encounter, so a
 * scanned activation QR can be routed in-app instead of triggering a full
 * page load in a foreign browser context.
 *
 * Activation URLs are minted as `<host>/wallet/activate/<tokenId>` — see
 * `buildActivationUrl()` in `lib/card-activation.ts` and the legacy OTC link in
 * `app/api/cards/[id]/scan/cb/actions/new-otc.ts` (which appends a trailing
 * slash). This parser tolerates the trailing slash and returns the host so the
 * caller can enforce a same-instance check.
 */

export interface ParsedActivationUrl {
  /** The activation token id (or legacy OTC) from the final path segment. */
  tokenId: string
  /** Host (with port) the URL points at, for a same-instance comparison. */
  host: string
}

// Token ids are hex (`randomBytes(16)`), but stay lenient so a future id scheme
// (base64url, etc.) keeps working — we only reject obviously-wrong segments.
const TOKEN_ID_RE = /^[A-Za-z0-9_-]+$/

/**
 * Parses `text` as a card activation URL, returning its `{ tokenId, host }`
 * when it matches `<host>/wallet/activate/<id>` (optional trailing slash), or
 * `null` for anything else (invoices, LNURLs, arbitrary URLs). Pure — no IO.
 */
export function parseActivationUrl(text: string): ParsedActivationUrl | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 3) return null
  if (segments[0] !== 'wallet' || segments[1] !== 'activate') return null

  const tokenId = segments[2]
  if (!TOKEN_ID_RE.test(tokenId)) return null

  return { tokenId, host: url.host }
}

/**
 * True when `host` (from {@link parseActivationUrl}) refers to the instance the
 * wallet is currently served from. Compared case-insensitively; returns `false`
 * on the server (no `window`).
 */
export function isSameInstanceHost(host: string): boolean {
  if (typeof window === 'undefined') return false
  return host.toLowerCase() === window.location.host.toLowerCase()
}
