import { prisma } from '@/lib/prisma'
import {
  DEFAULT_NOSTR_RELAYS,
  NOSTR_PROFILE_CACHE_TTL_MS,
  normalizeNostrPubkey,
  parseKind0ContentWithRaw,
  type NostrProfile,
} from '@/lib/nostr/profile'
import { precacheProfileImages } from '@/lib/nostr/profile-image-cache'
import { Prisma } from '@/lib/generated/prisma'

interface RelayProfileEvent {
  pubkey: string
  content: string
  created_at: number
}

type RelayFetcher = (pubkeys: string[]) => Promise<RelayProfileEvent[]>

interface ResolveProfilesOptions {
  force?: boolean
  now?: Date
  db?: typeof prisma
  relayFetcher?: RelayFetcher
  precacheImages?: (profile: NostrProfile) => Promise<void>
}

type NostrProfileCacheRow = Awaited<
  ReturnType<typeof prisma.nostrProfileCache.findMany>
>[number]

export async function resolveProfiles(
  inputs: string[],
  options: ResolveProfilesOptions = {},
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
  const candidatePubkeys = normalized.map(n => n.pubkey)
  const [users, identities] = await Promise.all([
    db.user.findMany({
      where: { pubkey: { in: candidatePubkeys } },
      select: { pubkey: true },
    }),
    db.nostrIdentity.findMany({
      where: { pubkey: { in: candidatePubkeys } },
      select: { pubkey: true },
    }),
  ])
  const registeredPubkeys = new Set([
    ...users.map(u => u.pubkey),
    ...identities.map(i => i.pubkey),
  ])
  const registered = normalized.filter(n => registeredPubkeys.has(n.pubkey))
  if (registered.length === 0) return []

  const cachedRows = await db.nostrProfileCache.findMany({
    where: { pubkey: { in: registered.map(n => n.pubkey) } },
  })
  const cachedByPubkey = new Map(cachedRows.map(row => [row.pubkey, row]))

  const pubkeysToFetch = registered
    .filter(n => {
      const cached = cachedByPubkey.get(n.pubkey)
      return force || !isFresh(cached, now)
    })
    .map(n => n.pubkey)

  const refreshed = new Map<string, NostrProfile>()
  if (pubkeysToFetch.length > 0) {
    const relayFetcher = options.relayFetcher ?? fetchProfilesFromRelays
    const attemptAt = now
    try {
      const events = await relayFetcher(pubkeysToFetch)
      const latest = newestEventByPubkey(events)

      await Promise.all(
        pubkeysToFetch.map(async pubkey => {
          const event = latest.get(pubkey)
          if (!event) {
            await markFetchFailure(db, pubkey, attemptAt, 'Profile not found on relays')
            return
          }

          const parsed = parseKind0ContentWithRaw(pubkey, event.content, {
            fetchedAt: attemptAt.getTime(),
          })
          if (!parsed) {
            await markFetchFailure(db, pubkey, attemptAt, 'Invalid kind-0 metadata')
            return
          }

          const profile = parsed.profile
          const rawMetadata = parsed.rawMetadata as Prisma.InputJsonObject
          await db.nostrProfileCache.upsert({
            where: { npub: profile.npub },
            create: {
              npub: profile.npub,
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
              rawMetadata,
              fetchedAt: attemptAt,
              lastFetchAttemptAt: attemptAt,
              lastFetchError: null,
            },
            update: {
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
              rawMetadata,
              fetchedAt: attemptAt,
              lastFetchAttemptAt: attemptAt,
              lastFetchError: null,
            },
          })

          refreshed.set(profile.pubkey, profile)
          const precache = options.precacheImages ?? precacheProfileImages
          void precache(profile).catch(() => {
            // Image cache is intentionally best-effort; metadata remains valid.
          })
        }),
      )
    } catch (err) {
      await Promise.all(
        pubkeysToFetch.map(pubkey =>
          markFetchFailure(db, pubkey, attemptAt, errorMessage(err)),
        ),
      )
    }
  }

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

export function profileFromCacheRow(
  row: NostrProfileCacheRow,
  now: Date = new Date(),
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
    stale: !isFresh(row, now),
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
  now: Date,
): boolean {
  return Boolean(
    row?.fetchedAt &&
      now.getTime() - row.fetchedAt.getTime() < NOSTR_PROFILE_CACHE_TTL_MS,
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
        pubkey: normalized.pubkey,
      })
    }
  }
  return latest
}

async function markFetchFailure(
  db: typeof prisma,
  pubkey: string,
  attemptAt: Date,
  message: string,
) {
  const normalized = normalizeNostrPubkey(pubkey)
  if (!normalized) return
  await db.nostrProfileCache.upsert({
    where: { npub: normalized.npub },
    create: {
      npub: normalized.npub,
      pubkey: normalized.pubkey,
      lastFetchAttemptAt: attemptAt,
      lastFetchError: message,
    },
    update: {
      lastFetchAttemptAt: attemptAt,
      lastFetchError: message,
    },
  })
}

async function fetchProfilesFromRelays(pubkeys: string[]): Promise<RelayProfileEvent[]> {
  const { SimplePool } = await import('nostr-tools/pool')
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(DEFAULT_NOSTR_RELAYS, {
      kinds: [0],
      authors: pubkeys,
    })
    return events
      .filter(event => event?.content)
      .map(event => ({
        pubkey: event.pubkey,
        content: event.content,
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
