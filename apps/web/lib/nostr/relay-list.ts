import { prisma } from '@/lib/prisma'
import { DEFAULT_NOSTR_RELAYS, normalizeNostrPubkey } from '@/lib/nostr/profile'

/**
 * Server-side NIP-65 (kind:10002) relay-list cache.
 *
 * `User.relays` is the effective relay list served by NIP-05 (`nostr.json`).
 * It's set two ways: manually via the relay picker (`PUT /api/users/[id]/relays`)
 * or auto-populated here from the user's published NIP-65 relay list. Both
 * stamp `User.relaysUpdatedAt`, the 6h freshness marker — so `nostr.json`
 * doesn't re-query Nostr on every request.
 *
 * `User.lastRelayFetchAttemptAt` is a separate, shorter-lived marker recording
 * that a fetch was attempted (success or failure). A fetch that resolves
 * nothing — including relay failures, which `nostr-tools` `querySync` surfaces
 * as `[]` rather than rejecting — records only the attempt without claiming
 * freshness, so a degraded answer is retried after a short backoff instead of
 * being pinned for the 6h TTL.
 */

const RELAY_LIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const RELAY_FETCH_TIMEOUT_MS = 3_000
// Min interval between relay fetch attempts for a single user. The public,
// unauthenticated `nostr.json` endpoint can't fan out to relays on every
// request; this gates retries after both successes (until the 6h TTL elapses)
// and failures/empty results (so a degraded answer is retried far sooner than
// the TTL, without per-request hammering).
const RELAY_FETCH_BACKOFF_MS = 60_000 // 60s

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
  lastRelayFetchAttemptAt?: Date | null
}

interface ResolveRelaysOptions {
  db?: typeof prisma
  now?: Date
  force?: boolean
  fetcher?: RelayListFetcher
}

/**
 * Resolve the effective Nostr relay list for a registered user (NIP-65):
 *  - Fresh cache (`relaysUpdatedAt` within the 6h TTL) → serve `User.relays`.
 *  - Otherwise, if a fetch was attempted within the short backoff window
 *    (`lastRelayFetchAttemptAt`) → serve `User.relays` without re-querying,
 *    so the public `nostr.json` endpoint doesn't fan out per request.
 *  - Otherwise → query the user's kind:10002 from Nostr:
 *    - When a list is found, persist it into `User.relays` (+ stamp
 *      `relaysUpdatedAt` AND `lastRelayFetchAttemptAt`) and return it.
 *    - When nothing is resolved — either the user published no NIP-65 list
 *      OR every relay failed/timed out (`nostr-tools` `querySync` resolves `[]`
 *      on failure rather than rejecting, and `withTimeout` resolves `null` on
 *      timeout, so the two are indistinguishable here) — record only the
 *      attempt (`lastRelayFetchAttemptAt`) WITHOUT bumping the 6h freshness
 *      marker, and keep the stored (possibly manual) list. The next request
 *      retries after the short backoff instead of serving a degraded answer
 *      for 6h.
 *
 * Returns `[]` when nothing is known; the caller falls back to the operator's
 * default relay list.
 */
export async function resolveUserRelays(
  user: UserRelayRow,
  options: ResolveRelaysOptions = {}
): Promise<string[]> {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const stored = parseStoredRelays(user.relays)

  const fresh =
    !options.force &&
    user.relaysUpdatedAt != null &&
    now.getTime() - user.relaysUpdatedAt.getTime() < RELAY_LIST_CACHE_TTL_MS
  if (fresh) return stored

  // A recent attempt (success or failure) suppresses a re-fetch within the
  // short backoff window. This is deliberately separate from `relaysUpdatedAt`
  // (freshness): a fetch that resolved nothing — including relay failures that
  // `querySync` surfaces as `[]` — records an attempt here WITHOUT claiming
  // freshness, so a still-unknown list is retried soon rather than pinned for
  // the 6h TTL.
  const onBackoff =
    !options.force &&
    user.lastRelayFetchAttemptAt != null &&
    now.getTime() - user.lastRelayFetchAttemptAt.getTime() <
      RELAY_FETCH_BACKOFF_MS
  if (onBackoff) return stored

  const normalized = normalizeNostrPubkey(user.pubkey)
  if (!normalized) return stored

  let fetched: string[] = []
  try {
    const fetcher = options.fetcher ?? fetchRelayListsFromRelays
    const events = await fetcher([normalized.pubkey])
    const latest = newestByPubkey(events).get(normalized.pubkey)
    if (latest) fetched = parseNip65Relays(latest.tags)
  } catch {
    // Import/init error only. `nostr-tools` `querySync` never rejects for
    // relay-level failures (it resolves `[]`), and `withTimeout` resolves
    // `null` on timeout — so relay failures don't throw, they land on the
    // empty branch below and are handled identically. Record the attempt
    // without claiming freshness, then serve whatever we already have.
    await stampAttempt(db, user.id, now)
    return stored
  }

  if (fetched.length === 0) {
    // No relay list resolved — "user published none" and "every relay
    // failed/timed out" are indistinguishable here (see catch comment above).
    // Record only the attempt so the next request retries after the short
    // backoff instead of pinning a degraded answer (operator defaults for a
    // user with no stored list) for the 6h TTL. Leave any stored (possibly
    // manual) list untouched.
    await stampAttempt(db, user.id, now)
    return stored
  }

  await db.user
    .update({
      where: { id: user.id },
      data: {
        relays: JSON.stringify(fetched),
        relaysUpdatedAt: now,
        lastRelayFetchAttemptAt: now
      }
    })
    .catch(() => {})
  return fetched
}

async function stampAttempt(db: typeof prisma, id: string, now: Date) {
  await db.user
    .update({ where: { id }, data: { lastRelayFetchAttemptAt: now } })
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
  pubkeys: string[]
): Promise<RelayListEvent[]> {
  const { SimplePool } = await import('nostr-tools/pool')
  const pool = new SimplePool()
  try {
    const events = await withTimeout(
      pool.querySync(DEFAULT_NOSTR_RELAYS, {
        kinds: [10002],
        authors: pubkeys
      }),
      RELAY_FETCH_TIMEOUT_MS
    )
    return (events ?? []).map(event => ({
      pubkey: event.pubkey,
      tags: event.tags,
      created_at: event.created_at
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
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms))
  ])
}
