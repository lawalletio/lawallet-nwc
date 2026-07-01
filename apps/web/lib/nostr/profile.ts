import { nip19 } from 'nostr-tools'

export const NOSTR_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.lawallet.ar',
]

export interface NostrProfile {
  pubkey: string
  npub: string
  name?: string
  displayName?: string
  picture?: string
  banner?: string
  about?: string
  nip05?: string
  lud16?: string
  website?: string
  fetchedAt: number
  stale?: boolean
}

export interface ParsedKind0Profile {
  profile: NostrProfile
  rawMetadata: Record<string, unknown>
}

export interface NormalizedNostrPubkey {
  pubkey: string
  npub: string
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

export function toNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey.toLowerCase())
}

export function normalizeNostrPubkey(input: string): NormalizedNostrPubkey | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (HEX_PUBKEY_RE.test(trimmed)) {
    const pubkey = trimmed.toLowerCase()
    return { pubkey, npub: toNpub(pubkey) }
  }

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
      return null
    }
    const pubkey = decoded.data.toLowerCase()
    if (!HEX_PUBKEY_RE.test(pubkey)) return null
    return { pubkey, npub: toNpub(pubkey) }
  } catch {
    return null
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function parseKind0Metadata(content: string): Record<string, unknown> | null {
  try {
    const meta = JSON.parse(content)
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return null
    }
    return meta as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Parse a kind-0 JSON content string into the fields this app cares about.
 */
export function parseKind0Content(
  pubkey: string,
  content: string,
  options?: { fetchedAt?: number },
): NostrProfile | null {
  const parsed = parseKind0ContentWithRaw(pubkey, content, options)
  return parsed?.profile ?? null
}

export function parseKind0ContentWithRaw(
  pubkey: string,
  content: string,
  options?: { fetchedAt?: number },
): ParsedKind0Profile | null {
  const normalized = normalizeNostrPubkey(pubkey)
  if (!normalized) return null

  const meta = parseKind0Metadata(content)
  if (!meta) return null

  return {
    rawMetadata: meta,
    profile: {
      pubkey: normalized.pubkey,
      npub: normalized.npub,
      name: optionalString(meta.name) || optionalString(meta.username),
      displayName: optionalString(meta.display_name) || optionalString(meta.displayName),
      picture: optionalString(meta.picture),
      banner: optionalString(meta.banner),
      about: optionalString(meta.about),
      nip05: optionalString(meta.nip05),
      lud16: optionalString(meta.lud16),
      website: optionalString(meta.website),
      fetchedAt: options?.fetchedAt ?? Date.now(),
    },
  }
}
