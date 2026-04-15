/**
 * Parsed public fields of an NWC connection string.
 * The `secret` is intentionally never exposed here.
 */
export interface ParsedNwc {
  /** Wallet service pubkey (host portion of the URI). */
  pubkey: string
  /** Relay URLs the wallet service listens on. */
  relays: string[]
  /** Human-readable name from the `name` or `lud16` query param, if present. */
  name: string | null
}

/**
 * Parses an NWC URI and extracts public (non-sensitive) details.
 * Format: nostr+walletconnect://<pubkey>?relay=wss://...&secret=...&lud16=...
 */
export function parseNwc(nwc: string): ParsedNwc | null {
  try {
    const url = new URL(nwc.replace('nostr+walletconnect://', 'https://'))
    return {
      pubkey: url.host,
      relays: url.searchParams.getAll('relay'),
      name:
        url.searchParams.get('name') || url.searchParams.get('lud16') || null,
    }
  } catch {
    return null
  }
}

/**
 * Truncates a hex pubkey to a short `8…8` display form.
 */
export function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}
