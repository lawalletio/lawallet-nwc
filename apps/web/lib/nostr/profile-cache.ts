import { prisma } from '@/lib/prisma'
import {
  DEFAULT_NOSTR_RELAYS,
  NOSTR_PROFILE_CACHE_TTL_MS,
  normalizeNostrPubkey,
  type NormalizedNostrPubkey,
  parseKind0ContentWithRaw,
  type NostrProfile
} from '@/lib/nostr/profile'
import {
  RELAY_FETCH_MAX_WAIT_MS,
  RELAY_FETCH_TIMEOUT_MS,
  withTimeout
} from '@/lib/nostr/relay-list'
import { precacheProfileImages } from '@/lib/nostr/profile-image-cache'
import { Prisma } from '@/lib/generated/prisma'

interface RelayProfileEvent {
  pubkey: string
  content: string
  created_at: number
}

type RelayFetcher = (pubkeys: string[]) => Promise<RelayProfileEvent[]>

// A failed or not-found fetch leaves `fetchedAt` null, so the row is never
// "fresh". Without this backoff every request re-queried the relays for it.
export const PROFILE_FETCH_BACKOFF_MS = 10 * 60 * 1000

interface ResolveProfilesOptions {
  force?: boolean
  now?: Date
  db?: typeof prisma
  relayFetcher?: RelayFetcher
  precacheImages?: (profile: NostrProfile) => Promise<void>
  /**
   * Runs a refresh after the response is sent (route handlers pass `after`
   * from next/server). When set, stale-but-cached profiles are returned
   * immediately and refreshed here; only pubkeys with nothing cached block on
   * the relays. Without it, every refresh is awaited inline.
   */
  schedule?: (task: () => Promise<void>) => void
}

type NostrProfileCacheRow = Awaited<
  ReturnType<typeof prisma.nostrProfileCache.findMany>
>[number]

export async function resolveProfiles(
  inputs: string[],
  options: ResolveProfilesOptions = {}
): Promise<NostrProfile[]> {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const force = options.force ?? false
  const normalized = uniqueNormalized(inputs)
  if (normalized.length === 0) return []

  // A pubkey is "registered" if it belongs to any account — as the primary
  // (mirrored on User.pubkey) OR as a linked NostrIdentity. Secondary
  // identities only live in NostrIdentity, so gating on User.pubkey alone
  // would drop their profiles (and their avatars on /admin/account).
  //
  // A pubkey referenced by a stored Voucher is resolvable too. Merchants and
  // coupon-manager services are never accounts here, but their keys are
  // already in our database because somebody deposited a coupon naming them —
  // so resolving them leaks nothing new and is what puts a real name and
  // avatar on the voucher detail page. The anti-relay-proxy property holds:
  // the caller still cannot ask for an arbitrary pubkey, only one this
  // instance already stores.
  const candidatePubkeys = normalized.map(n => n.pubkey)
  const [users, identities, vouchers] = await Promise.all([
    db.user.findMany({
      where: { pubkey: { in: candidatePubkeys } },
      select: { pubkey: true }
    }),
    db.nostrIdentity.findMany({
      where: { pubkey: { in: candidatePubkeys } },
      select: { pubkey: true }
    }),
    db.voucher.findMany({
      where: {
        OR: [
          { merchantPubkey: { in: candidatePubkeys } },
          { servicePubkey: { in: candidatePubkeys } }
        ]
      },
      select: { merchantPubkey: true, servicePubkey: true },
      distinct: ['merchantPubkey', 'servicePubkey']
    })
  ])
  const registeredPubkeys = new Set([
    ...users.map(u => u.pubkey),
    ...identities.map(i => i.pubkey),
    ...vouchers.flatMap(v => [v.merchantPubkey, v.servicePubkey])
  ])
  const registered = normalized.filter(n => registeredPubkeys.has(n.pubkey))
  if (registered.length === 0) return []

  const cachedRows = await db.nostrProfileCache.findMany({
    where: { pubkey: { in: registered.map(n => n.pubkey) } }
  })
  const cachedByPubkey = new Map(cachedRows.map(row => [row.pubkey, row]))

  const toFetch = registered.filter(n => {
    const cached = cachedByPubkey.get(n.pubkey)
    return force || (!isFresh(cached, now) && !recentlyAttempted(cached, now))
  })

  // Stale-while-revalidate: a stale row still yields a profile, so serve it
  // and refresh after the response. Only missing (or forced) profiles block.
  const schedule = options.schedule
  const blocking: NormalizedNostrPubkey[] = []
  const background: NormalizedNostrPubkey[] = []
  for (const n of toFetch) {
    const cached = cachedByPubkey.get(n.pubkey)
    const servable = !force && cached && profileFromCacheRow(cached, now)
    if (schedule && servable) background.push(n)
    else blocking.push(n)
  }
  if (schedule && background.length > 0) {
    schedule(async () => {
      await refreshProfiles(background, db, now, options)
    })
  }

  const refreshed =
    blocking.length > 0
      ? await refreshProfiles(blocking, db, now, options)
      : new Map<string, NostrProfile>()

  const result: NostrProfile[] = []
  for (const item of registered) {
    const fresh = refreshed.get(item.pubkey)
    if (fresh) {
      result.push(fresh)
      continue
    }

    const cached = cachedByPubkey.get(item.pubkey)
    const profile = cached ? profileFromCacheRow(cached, now) : null
    if (profile) result.push(profile)
  }

  return result
}

async function refreshProfiles(
  toFetch: NormalizedNostrPubkey[],
  db: typeof prisma,
  now: Date,
  options: ResolveProfilesOptions
): Promise<Map<string, NostrProfile>> {
  const refreshed = new Map<string, NostrProfile>()
  const relayFetcher = options.relayFetcher ?? fetchProfilesFromRelays
  const attemptAt = now
  try {
    const events = await relayFetcher(toFetch.map(n => n.pubkey))
    const latest = newestEventByPubkey(events)

    // One transaction for every write instead of an upsert per pubkey
    // (Sentry LAWALLET-WEB-Q, N+1 on POST /api/nostr/profiles).
    const writes: Prisma.PrismaPromise<unknown>[] = []
    const fetched: NostrProfile[] = []
    for (const key of toFetch) {
      const pubkey = key.pubkey
      const event = latest.get(pubkey)
      if (!event) {
        writes.push(
          fetchFailureWrite(db, key, attemptAt, 'Profile not found on relays')
        )
        continue
      }

      const parsed = parseKind0ContentWithRaw(pubkey, event.content, {
        fetchedAt: attemptAt.getTime()
      })
      if (!parsed) {
        writes.push(
          fetchFailureWrite(db, key, attemptAt, 'Invalid kind-0 metadata')
        )
        continue
      }

      const profile = parsed.profile
      const data = {
        pubkey: profile.pubkey,
        name: profile.name ?? null,
        displayName: profile.displayName ?? null,
        about: profile.about ?? null,
        nip05: profile.nip05 ?? null,
        lud16: profile.lud16 ?? null,
        website: profile.website ?? null,
        pictureUrl: profile.picture ?? null,
        bannerUrl: profile.banner ?? null,
        kind0CreatedAt: new Date(event.created_at * 1000),
        rawMetadata: parsed.rawMetadata as Prisma.InputJsonObject,
        fetchedAt: attemptAt,
        lastFetchAttemptAt: attemptAt,
        lastFetchError: null
      }
      writes.push(
        db.nostrProfileCache.upsert({
          where: { npub: profile.npub },
          create: { npub: profile.npub, ...data },
          update: data
        })
      )
      fetched.push(profile)
    }

    await db.$transaction(writes)

    const precache = options.precacheImages ?? precacheProfileImages
    for (const profile of fetched) {
      refreshed.set(profile.pubkey, profile)
      void precache(profile).catch(() => {
        // Image cache is intentionally best-effort; metadata remains valid.
      })
    }
  } catch (err) {
    await db.$transaction(
      toFetch.map(key =>
        fetchFailureWrite(db, key, attemptAt, errorMessage(err))
      )
    )
  }
  return refreshed
}

export function profileFromCacheRow(
  row: NostrProfileCacheRow,
  now: Date = new Date()
): NostrProfile | null {
  if (!row.fetchedAt) return null
  return {
    pubkey: row.pubkey,
    npub: row.npub,
    name: row.name ?? undefined,
    displayName: row.displayName ?? undefined,
    picture: row.pictureUrl ?? undefined,
    banner: row.bannerUrl ?? undefined,
    about: row.about ?? undefined,
    nip05: row.nip05 ?? undefined,
    lud16: row.lud16 ?? undefined,
    website: row.website ?? undefined,
    fetchedAt: row.fetchedAt.getTime(),
    stale: !isFresh(row, now)
  }
}

function uniqueNormalized(inputs: string[]) {
  const seen = new Set<string>()
  const out: NonNullable<ReturnType<typeof normalizeNostrPubkey>>[] = []
  for (const input of inputs) {
    const normalized = normalizeNostrPubkey(input)
    if (!normalized || seen.has(normalized.pubkey)) continue
    seen.add(normalized.pubkey)
    out.push(normalized)
  }
  return out
}

function isFresh(
  row: NostrProfileCacheRow | null | undefined,
  now: Date
): boolean {
  return Boolean(
    row?.fetchedAt &&
    now.getTime() - row.fetchedAt.getTime() < NOSTR_PROFILE_CACHE_TTL_MS
  )
}

function recentlyAttempted(
  row: NostrProfileCacheRow | null | undefined,
  now: Date
): boolean {
  return Boolean(
    row?.lastFetchAttemptAt &&
    now.getTime() - row.lastFetchAttemptAt.getTime() < PROFILE_FETCH_BACKOFF_MS
  )
}

function newestEventByPubkey(events: RelayProfileEvent[]) {
  const latest = new Map<string, RelayProfileEvent>()
  for (const event of events) {
    const normalized = normalizeNostrPubkey(event.pubkey)
    if (!normalized) continue
    const prev = latest.get(normalized.pubkey)
    if (!prev || event.created_at > prev.created_at) {
      latest.set(normalized.pubkey, {
        ...event,
        pubkey: normalized.pubkey
      })
    }
  }
  return latest
}

// Returns the lazy (unexecuted) upsert so callers can batch it into one
// transaction.
function fetchFailureWrite(
  db: typeof prisma,
  key: NormalizedNostrPubkey,
  attemptAt: Date,
  message: string
) {
  return db.nostrProfileCache.upsert({
    where: { npub: key.npub },
    create: {
      npub: key.npub,
      pubkey: key.pubkey,
      lastFetchAttemptAt: attemptAt,
      lastFetchError: message
    },
    update: {
      lastFetchAttemptAt: attemptAt,
      lastFetchError: message
    }
  })
}

async function fetchProfilesFromRelays(
  pubkeys: string[]
): Promise<RelayProfileEvent[]> {
  const { SimplePool } = await import('nostr-tools/pool')
  const pool = new SimplePool()
  try {
    // querySync has no overall deadline: one slow relay (relay.nostr.band
    // p95 121s) held the request open. `maxWait` caps each relay's EOSE wait
    // and `withTimeout` caps the whole call.
    const events = await withTimeout(
      pool.querySync(
        DEFAULT_NOSTR_RELAYS,
        { kinds: [0], authors: pubkeys },
        { maxWait: RELAY_FETCH_MAX_WAIT_MS }
      ),
      RELAY_FETCH_TIMEOUT_MS
    )
    if (!events) throw new Error('Relay query timed out')
    return events
      .filter(event => event?.content)
      .map(event => ({
        pubkey: event.pubkey,
        content: event.content,
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
