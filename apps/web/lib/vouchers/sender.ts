import { normalizeNostrPubkey } from '@/lib/nostr/profile'

const NIP05_RE = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i
const LOOKUP_TIMEOUT_MS = 5_000

interface Nip05Response {
  names?: Record<string, string>
}

/**
 * Resolve one allowlist entry — hex, `npub1…`, or a NIP-05 identifier — to a
 * hex pubkey.
 *
 * Resolution happens once, on save, so the deposit hot path is an array
 * membership test rather than a network call per request. That also means a
 * sender stays allowed if their NIP-05 later moves, which is the safer
 * failure mode: an allowlist that silently loses entries when a domain goes
 * down would drop legitimate vouchers on the floor.
 *
 * @returns The hex pubkey, or null when the entry can't be resolved.
 */
export async function resolveVoucherSender(
  entry: string
): Promise<string | null> {
  const trimmed = entry.trim()
  if (!trimmed) return null

  const direct = normalizeNostrPubkey(trimmed)
  if (direct) return direct.pubkey

  const match = NIP05_RE.exec(trimmed)
  if (!match) return null
  const [, name, domain] = match

  try {
    const response = await fetch(
      `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
      {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
      }
    )
    if (!response.ok) return null
    const body = (await response.json()) as Nip05Response
    // NIP-05 name lookup is case-insensitive in practice; `_` is the root.
    const names = body.names ?? {}
    const key =
      Object.keys(names).find(k => k.toLowerCase() === name.toLowerCase()) ??
      null
    const pubkey = key ? names[key] : null
    return pubkey ? (normalizeNostrPubkey(pubkey)?.pubkey ?? null) : null
  } catch {
    return null
  }
}

/**
 * Resolve a whole allowlist, reporting which entries failed so the owner can
 * fix a typo instead of silently saving a shorter list than they typed.
 */
export async function resolveVoucherSenders(
  entries: string[]
): Promise<{ pubkeys: string[]; unresolved: string[] }> {
  const results = await Promise.all(
    entries.map(async entry => ({
      entry,
      pubkey: await resolveVoucherSender(entry)
    }))
  )
  const unresolved = results.filter(r => !r.pubkey).map(r => r.entry)
  // Dedupe: two entries (an npub and its NIP-05) can name one key.
  const pubkeys = [
    ...new Set(results.flatMap(r => (r.pubkey ? [r.pubkey] : [])))
  ]
  return { pubkeys, unresolved }
}
