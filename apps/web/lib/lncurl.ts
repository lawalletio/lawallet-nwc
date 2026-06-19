/**
 * Default LNCurl server. LNCurl hands out an ephemeral, custodial NWC wallet on
 * demand: POST to the origin and it returns a fresh `nostr+walletconnect://`
 * pairing URI we can persist as a {@link RemoteWallet}.
 *
 * The trailing slash is significant — we strip it before POSTing so the request
 * always targets the bare origin (`https://lncurl.lol`), matching what the
 * server expects.
 */
export const DEFAULT_LNCURL_SERVER = 'https://lncurl.lol/'

/** Result of provisioning a fresh LNCurl wallet. */
export interface LncurlWallet {
  /** The freshly minted NWC pairing URI. */
  connectionString: string
  /** LNCurl wallets can send and receive. */
  mode: 'SEND_RECEIVE'
}

const NWC_URI_RE = /(nostr\+walletconnect|nostrwalletconnect):\/\/[^\s"'`<>]+/i

function isNwcUri(value: string): boolean {
  return (
    value.startsWith('nostr+walletconnect://') ||
    value.startsWith('nostrwalletconnect://')
  )
}

/**
 * Depth-first scan of an arbitrary JSON value for the first string that *is* a
 * bare NWC URI. LNCurl deployments vary in the field name they use
 * (`nwc`, `connectionString`, `pairingUri`, …) so we don't hard-code one.
 */
function findNwcInJson(value: unknown): string | null {
  if (typeof value === 'string') {
    return isNwcUri(value.trim()) ? value.trim() : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNwcInJson(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findNwcInJson(item)
      if (found) return found
    }
  }
  return null
}

/**
 * Parse a NWC pairing URI out of a server response body, defensively, in three
 * passes so we tolerate however a given LNCurl deployment frames its reply:
 *
 *   1. The body *is* a bare NWC URI (plain-text response).
 *   2. The body is JSON and some string field holds the URI (depth-first).
 *   3. The URI is embedded in free text (regex extraction).
 *
 * Returns `null` when nothing resembling a NWC URI is present so the caller can
 * raise a descriptive error.
 */
function parseNwcUri(body: string): string | null {
  const trimmed = body.trim()

  // (a) bare-text URI
  if (isNwcUri(trimmed)) return trimmed

  // (b) JSON body — scan for a string field holding the URI
  try {
    const parsed = JSON.parse(trimmed)
    const found = findNwcInJson(parsed)
    if (found) return found
  } catch {
    // not JSON — fall through to free-text extraction
  }

  // (c) URI embedded in prose
  const match = trimmed.match(NWC_URI_RE)
  if (match) return match[0]

  return null
}

/**
 * Provision a fresh LNCurl custodial wallet and return its NWC connection
 * string. The whole point is "tap a button, get a working wallet" — the caller
 * persists the returned `connectionString` as a {@link RemoteWallet}.
 *
 * @throws if the server is unreachable, returns a non-2xx status, or returns a
 *         body with no parseable NWC URI.
 */
export async function createLncurlWallet(
  serverUrl: string = DEFAULT_LNCURL_SERVER,
): Promise<LncurlWallet> {
  // Strip the trailing slash so we always POST to the bare origin.
  const origin = serverUrl.replace(/\/+$/, '')

  // NOTE: keep this module dependency-free (no server-only imports like the
  // logger). It exports `DEFAULT_LNCURL_SERVER`, which client components import,
  // so pulling in the logger here would drag `node:async_hooks` into the browser
  // bundle. The thrown messages below carry enough context; callers log them.
  let res: Response
  try {
    res = await fetch(origin, { method: 'POST' })
  } catch {
    throw new Error(`LNCurl server unreachable: ${origin}`)
  }

  const body = await res.text()

  if (!res.ok) {
    throw new Error(`LNCurl server returned ${res.status}`)
  }

  const connectionString = parseNwcUri(body)
  if (!connectionString) {
    throw new Error('LNCurl response did not contain a nostr+walletconnect:// URI')
  }

  return { connectionString, mode: 'SEND_RECEIVE' }
}
