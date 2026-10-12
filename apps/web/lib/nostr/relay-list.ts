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
export const RELAY_FETCH_TIMEOUT_MS = 3_000
// Per-relay EOSE wait handed to `querySync`; kept under the hard cap so the
// pool returns whatever arrived before `withTimeout` gives up on the call.
export const RELAY_FETCH_MAX_WAIT_MS = 2_500
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
  /**
   * Runs the relay refresh after the response is sent (route handlers pass
   * `after` from next/server), so the caller is served `User.relays` without
   * waiting on Nostr. Without it the refresh is awaited inline.
   */
  schedule?: (task: () => Promise<void>) => void
}

/**
 * Resolve the effective Nostr relay list for a registered user (NIP-65):
 *  - Fresh cache (`relaysUpdatedAt` within the 6h TTL) → serve `User.relays`.
 *  - Otherwise, if a fetch was attempted within the short backoff window
 *    (`lastRelayFetchAttemptAt`) → serve `User.relays` without re-querying,
 *    so the public `nostr.json` endpoint doesn't fan out per request.
 *  - Otherwise → atomically claim the attempt (`lastRelayFetchAttemptAt`)
 *    before querying, so concurrent requests don't all fetch; a request that
 *    loses the claim serves `User.relays`. The winner queries kind:10002 —
 *    inline, or after the response when `schedule` is passed:
 *    - When a list is found, persist it into `User.relays` (+ stamp
 *      `relaysUpdatedAt`) and return it.
 *    - When nothing is resolved — either the user published no NIP-65 list
 *      OR every relay failed/timed out (`nostr-tools` `querySync` resolves `[]`
 *      on failure rather than rejecting, and `withTimeout` resolves `null` on
 *      timeout, so the two are indistinguishable here) — the attempt stamp is
 *      the only write, WITHOUT bumping the 6h freshness
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

  // Claim the attempt BEFORE querying relays: a conditional update, so of N
  // concurrent nostr.json requests only the one that moves the marker fetches.
  // This stamp alone never claims freshness — a fetch that resolves nothing
  // (no NIP-65 list, or every relay failed/timed out; `querySync` resolves
  // `[]` and `withTimeout` resolves `null`, so the two are indistinguishable)
  // leaves it as the only write, and the list is retried after the backoff.
  const claimed = await db.user
    .updateMany({
      where: {
        id: user.id,
        ...(options.force
          ? {}
          : {
              OR: [
                { lastRelayFetchAttemptAt: null },
                {
                  lastRelayFetchAttemptAt: {
                    lt: new Date(now.getTime() - RELAY_FETCH_BACKOFF_MS)
                  }
                }
              ]
            })
      },
      data: { lastRelayFetchAttemptAt: now }
    })
    .then(r => r.count > 0)
    .catch(() => false)
  if (!claimed) return stored

  const refresh = async (): Promise<string[]> => {
    let fetched: string[] = []
    try {
      const fetcher = options.fetcher ?? fetchRelayListsFromRelays
      const events = await fetcher([normalized.pubkey])
      const latest = newestByPubkey(events).get(normalized.pubkey)
      if (latest) fetched = parseNip65Relays(latest.tags)
    } catch {
      // Import/init error only — relay failures resolve `[]` (see above).
    }
    // Nothing resolved: keep any stored (possibly manual) list untouched.
    if (fetched.length === 0) return stored

    await db.user
      .update({
        where: { id: user.id },
        data: { relays: JSON.stringify(fetched), relaysUpdatedAt: now }
      })
      .catch(() => {})
    return fetched
  }

  if (options.schedule) {
    options.schedule(async () => {
      await refresh()
    })
    return stored
  }
  return refresh()
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
      pool.querySync(
        DEFAULT_NOSTR_RELAYS,
        { kinds: [10002], authors: pubkeys },
        { maxWait: RELAY_FETCH_MAX_WAIT_MS }
      ),
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

/** Resolves `null` if `promise` hasn't settled within `ms`. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms))
  ])
}
