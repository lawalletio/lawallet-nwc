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
 * Formats a date string or Date as relative time.
 * Example: "2 hours ago", "3 days ago", "just now"
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
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
