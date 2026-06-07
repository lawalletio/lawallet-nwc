import { nip19 } from 'nostr-tools'

/**
 * Converts a hex pubkey to npub and truncates for display.
 * Example: "npub1abc...xyz4"
 */
export function truncateNpub(pubkey: string, chars: number = 8): string {
  try {
    const npub = nip19.npubEncode(pubkey)
    if (npub.length <= chars * 2 + 3) return npub
    return `${npub.slice(0, chars + 5)}...${npub.slice(-chars)}`
  } catch {
    // Fallback for invalid pubkeys
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
  }
}

/**
 * Two-character avatar fallback for a pubkey: the first two characters of its
 * npub *after* the `npub1` prefix, uppercased (e.g. `npub1q8z…` → `Q8`).
 *
 * Deterministic and independent of profile metadata, so the placeholder stays
 * stable while the avatar image loads or when no kind-0 name is available.
 * Returns `??` for a missing pubkey and falls back to the hex prefix if the
 * pubkey can't be encoded.
 */
export function npubInitials(pubkey: string | null | undefined): string {
  if (!pubkey) return '??'
  try {
    // `npub1` is a 5-char prefix, so the data part starts at index 5.
    return nip19.npubEncode(pubkey).slice(5, 7).toUpperCase()
  } catch {
    return pubkey.slice(0, 2).toUpperCase()
  }
}

/**
 * Formats a date string or Date as relative time.
 * Example: "2 hours ago", "3 days ago", "just now"
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return 'just now'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`

  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears}y ago`
}

/**
 * Truncates a hex string (card IDs, etc.) for display.
 * Example: "04:ab:cd:ef" → "04:ab:...ef"
 */
export function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 3) return hex
  return `${hex.slice(0, chars)}...${hex.slice(-chars)}`
}
