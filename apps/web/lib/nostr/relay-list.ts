import { prisma } from '@/lib/prisma'
import { DEFAULT_NOSTR_RELAYS, normalizeNostrPubkey } from '@/lib/nostr/profile'

/**
 * Server-side NIP-65 (kind:10002) relay-list cache.
 *
 * `User.relays` is the effective relay list served by NIP-05 (`nostr.json`).
 * It's set two ways: manually via the relay picker (`PUT /api/users/[id]/relays`)
 * or auto-populated here from the user's published NIP-65 relay list. Both stamp
 * `User.relaysUpdatedAt`, which is the cache TTL — so `nostr.json` doesn't
 * re-query Nostr on every request.
 */

const RELAY_LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const RELAY_FETCH_TIMEOUT_MS = 3_000

interface RelayListEvent {
  pubkey: string
  tags: string[][]
  created_at: number
}

type RelayListFetcher = (pubkeys: string[]) => Promise<RelayListEvent[]>

/** Extract relay URLs from a NIP-65 (kind:10002) event's `r` tags. */
export function parseNip65Relays(tags: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    if (tag[0] !== 'r') continue
    const url = (tag[1] ?? '').trim()
    if (!(url.startsWith('wss://') || url.startsWith('ws://'))) continue
    const key = url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

/** Parse the stored `User.relays` JSON string into a clean `string[]`. */
export function parseStoredRelays(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

interface UserRelayRow {
  id: string
  pubkey: string
  relays: string | null
  relaysUpdatedAt: Date | null
}

interface ResolveRelaysOptions {
  db?: typeof prisma
  now?: Date
  force?: boolean
  fetcher?: RelayListFetcher
}

/**
 * Resolve the effective Nostr relay list for a registered user (NIP-65):
 *  - Fresh cache (`relaysUpdatedAt` within TTL) → serve `User.relays` as-is.
 *  - Stale/never fetched → query the user's kind:10002 from Nostr. When found,
 *    persist it into `User.relays` (+ stamp `relaysUpdatedAt`) and return it.
 *    When NOT found, only stamp the check (so we don't refetch every request)
 *    and keep the stored value — a manual relay-picker choice survives for
 *    users who haven't published a NIP-65 list.
 *
 * Returns `[]` when nothing is known; the caller falls back to the operator's
 * default relay list.
 */
export async function resolveUserRelays(
  user: UserRelayRow,
  options: ResolveRelaysOptions = {},
): Promise<string[]> {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const stored = parseStoredRelays(user.relays)

  const fresh =
    !options.force &&
    user.relaysUpdatedAt != null &&
    now.getTime() - user.relaysUpdatedAt.getTime() < RELAY_LIST_CACHE_TTL_MS
  if (fresh) return stored

  const normalized = normalizeNostrPubkey(user.pubkey)
  if (!normalized) return stored

  let fetched: string[] = []
  try {
    const fetcher = options.fetcher ?? fetchRelayListsFromRelays
    const events = await fetcher([normalized.pubkey])
    const latest = newestByPubkey(events).get(normalized.pubkey)
    if (latest) fetched = parseNip65Relays(latest.tags)
  } catch {
    // Relay unreachable / timed out — serve whatever we already have.
    return stored
  }

  if (fetched.length === 0) {
    // No NIP-65 published. Stamp the check so we don't re-query for a TTL, but
    // leave the stored (possibly manual) list untouched.
    await stampChecked(db, user.id, now)
    return stored
  }

  await db.user
    .update({
      where: { id: user.id },
      data: { relays: JSON.stringify(fetched), relaysUpdatedAt: now },
    })
    .catch(() => {})
  return fetched
}

async function stampChecked(db: typeof prisma, id: string, now: Date) {
  await db.user
    .update({ where: { id }, data: { relaysUpdatedAt: now } })
    .catch(() => {})
}

function newestByPubkey(events: RelayListEvent[]) {
  const map = new Map<string, RelayListEvent>()
  for (const event of events) {
    const normalized = normalizeNostrPubkey(event.pubkey)
    if (!normalized) continue
    const prev = map.get(normalized.pubkey)
    if (!prev || event.created_at > prev.created_at) {
      map.set(normalized.pubkey, { ...event, pubkey: normalized.pubkey })
    }
  }
  return map
}

async function fetchRelayListsFromRelays(
  pubkeys: string[],
): Promise<RelayListEvent[]> {
  const { SimplePool } = await import('nostr-tools/pool')
  const pool = new SimplePool()
  try {
    const events = await withTimeout(
      pool.querySync(DEFAULT_NOSTR_RELAYS, { kinds: [10002], authors: pubkeys }),
      RELAY_FETCH_TIMEOUT_MS,
    )
    return (events ?? []).map(event => ({
      pubkey: event.pubkey,
      tags: event.tags,
      created_at: event.created_at,
    }))
  } finally {
    try {
      pool.close(DEFAULT_NOSTR_RELAYS)
    } catch {
      // best-effort cleanup
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
}
