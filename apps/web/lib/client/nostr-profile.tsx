'use client'

import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react'

const CACHE_KEY = 'lawallet-nostr-profiles'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.lawallet.ar',
]

const DEFAULT_RELAYS = DEFAULT_NOSTR_RELAYS

/**
 * Parse a kind-0 JSON content string into the fields this app cares about.
 * Exported so the publish helper can round-trip a signed event straight
 * back into the cache without duplicating the field mapping.
 */
export function parseKind0Content(pubkey: string, content: string): NostrProfile | null {
  try {
    const meta = JSON.parse(content)
    return {
      pubkey,
      name: meta.name || meta.username,
      displayName: meta.display_name || meta.displayName,
      picture: meta.picture,
      banner: meta.banner,
      about: meta.about,
      nip05: meta.nip05,
      lud16: meta.lud16,
      website: meta.website,
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}

export interface NostrProfile {
  pubkey: string
  name?: string
  displayName?: string
  picture?: string
  banner?: string
  about?: string
  nip05?: string
  lud16?: string
  website?: string
  fetchedAt: number
}

interface ProfileCache {
  [pubkey: string]: NostrProfile
}

interface NostrProfileContextValue {
  getProfile: (pubkey: string) => NostrProfile | null
  fetchProfile: (pubkey: string) => Promise<NostrProfile | null>
  /**
   * Resolve many pubkeys in a single relay round-trip. Pubkeys already fresh
   * in the cache (or in flight) are skipped; the rest are fetched with one
   * batched filter. Returns the freshly-fetched profiles keyed by pubkey —
   * callers should merge these over whatever they already had cached.
   */
  fetchProfiles: (pubkeys: string[]) => Promise<Record<string, NostrProfile>>
  /**
   * Seed a freshly-signed kind-0 straight into the cache. Used after the
   * user publishes their own profile so the UI reflects the change
   * immediately without waiting on the relay round-trip.
   */
  updateProfile: (pubkey: string, profile: NostrProfile) => void
}

const NostrProfileContext = createContext<NostrProfileContextValue | null>(null)

export function useNostrProfile(pubkey: string | null): {
  profile: NostrProfile | null
  loading: boolean
  /**
   * Replace the cached profile for this pubkey (and rerender). Used after
   * the authenticated user publishes a kind-0 so the avatar/banner/name/
   * about swap locally without waiting for the relay to echo back.
   */
  updateProfile: (next: NostrProfile) => void
} {
  const ctx = useContext(NostrProfileContext)
  if (!ctx) {
    throw new Error('useNostrProfile must be used within a NostrProfileProvider')
  }

  const cachedProfile = pubkey ? ctx.getProfile(pubkey) : null
  const [profile, setProfile] = useState<NostrProfile | null>(cachedProfile)
  const [loading, setLoading] = useState(false)

  // Stale-while-revalidate: show cached immediately, fetch fresh in background
  useEffect(() => {
    let cancelled = false

    if (!pubkey) {
      queueMicrotask(() => {
        if (!cancelled) {
          setProfile(null)
          setLoading(false)
        }
      })
      return () => { cancelled = true }
    }

    if (!cachedProfile) {
      queueMicrotask(() => {
        if (!cancelled) setLoading(true)
      })
    }

    ctx.fetchProfile(pubkey).then((result) => {
      if (!cancelled && result) {
        setProfile(result)
      }
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [pubkey, cachedProfile, ctx])

  const updateProfile = useCallback(
    (next: NostrProfile) => {
      if (!pubkey) return
      ctx.updateProfile(pubkey, next)
      setProfile(next)
    },
    [ctx, pubkey],
  )

  return { profile: cachedProfile ?? profile, loading, updateProfile }
}

/**
 * Resolve many profiles at once, for lists/pickers. Seeds synchronously from
 * the cache, then revalidates the whole set in a single batched relay query.
 * Returns a `pubkey → profile | null` map plus a `loading` flag (true until the
 * first batch settles when nothing was cached).
 *
 * Backed by the same cache as {@link useNostrProfile}, so a row resolved here
 * is instantly available to a later single-pubkey lookup, and vice-versa.
 */
export function useNostrProfiles(pubkeys: string[]): {
  profiles: Record<string, NostrProfile | null>
  loading: boolean
} {
  const ctx = useContext(NostrProfileContext)
  if (!ctx) {
    throw new Error('useNostrProfiles must be used within a NostrProfileProvider')
  }

  // Stable dependency: the set of pubkeys, order-independent.
  const key = Array.from(new Set(pubkeys.filter(Boolean))).sort().join(',')

  const seed = useCallback((): Record<string, NostrProfile | null> => {
    const map: Record<string, NostrProfile | null> = {}
    for (const pk of pubkeys) {
      if (pk) map[pk] = ctx.getProfile(pk)
    }
    return map
    // `key` captures the meaningful identity of `pubkeys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key])

  const [profiles, setProfiles] = useState<Record<string, NostrProfile | null>>(seed)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const current = seed()
    setProfiles(current)

    const allCached = Object.values(current).every(Boolean)
    if (key && !allCached) {
      queueMicrotask(() => {
        if (!cancelled) setLoading(true)
      })
    }

    ctx
      .fetchProfiles(key ? key.split(',') : [])
      .then(fetched => {
        if (cancelled) return
        if (Object.keys(fetched).length > 0) {
          setProfiles(prev => ({ ...prev, ...fetched }))
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx])

  return { profiles, loading }
}

export function NostrProfileProvider({ children }: { children: React.ReactNode }) {
  const cacheRef = useRef<ProfileCache>(loadCache())
  const inflightRef = useRef<Map<string, Promise<NostrProfile | null>>>(new Map())

  const getProfile = useCallback((pubkey: string): NostrProfile | null => {
    const cached = cacheRef.current[pubkey]
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached
    }
    return null
  }, [])

  const fetchProfile = useCallback(async (pubkey: string): Promise<NostrProfile | null> => {
    // Deduplicate in-flight requests
    const existing = inflightRef.current.get(pubkey)
    if (existing) return existing

    const promise = fetchFromRelays(pubkey).then((profile) => {
      if (profile) {
        cacheRef.current[pubkey] = profile
        saveCache(cacheRef.current)
      }
      inflightRef.current.delete(pubkey)
      return profile
    })

    inflightRef.current.set(pubkey, promise)
    return promise
  }, [])

  const fetchProfiles = useCallback(
    async (pubkeys: string[]): Promise<Record<string, NostrProfile>> => {
      // De-dupe input and drop pubkeys that are already fresh or in flight —
      // the in-flight ones will populate the cache on their own.
      const unique = Array.from(new Set(pubkeys.filter(Boolean)))
      const missing = unique.filter(
        pk => {
          const cached = cacheRef.current[pk]
          const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS
          return !fresh && !inflightRef.current.has(pk)
        },
      )

      if (missing.length === 0) return {}

      // One promise for the whole batch; register it per-pubkey so concurrent
      // single fetchProfile() calls de-dupe against it.
      const batch = fetchManyFromRelays(missing).then(profiles => {
        for (const profile of profiles) {
          cacheRef.current[profile.pubkey] = profile
        }
        if (profiles.length > 0) saveCache(cacheRef.current)
        for (const pk of missing) inflightRef.current.delete(pk)
        return Object.fromEntries(profiles.map(p => [p.pubkey, p]))
      })

      for (const pk of missing) {
        inflightRef.current.set(
          pk,
          batch.then(map => map[pk] ?? null),
        )
      }

      return batch
    },
    [],
  )

  const updateProfile = useCallback(
    (pubkey: string, profile: NostrProfile) => {
      cacheRef.current[pubkey] = profile
      saveCache(cacheRef.current)
    },
    [],
  )

  const value: NostrProfileContextValue = {
    getProfile,
    fetchProfile,
    fetchProfiles,
    updateProfile,
  }

  return (
    <NostrProfileContext.Provider value={value}>
      {children}
    </NostrProfileContext.Provider>
  )
}

// ─── Relay fetching ────────────────────────────────────────────────────────

async function fetchFromRelays(pubkey: string): Promise<NostrProfile | null> {
  try {
    const { SimplePool } = await import('nostr-tools/pool')
    const pool = new SimplePool()

    const event = await pool.get(DEFAULT_RELAYS, {
      kinds: [0],
      authors: [pubkey],
    })

    pool.close(DEFAULT_RELAYS)

    if (!event?.content) return null

    return parseKind0Content(pubkey, event.content)
  } catch {
    return null
  }
}

/**
 * Batched variant of {@link fetchFromRelays}: resolves many pubkeys with a
 * single `{ kinds: [0], authors }` filter. Relays may return several kind-0s
 * per author, so we keep the newest by `created_at`. Returns one parsed
 * profile per author that had at least one usable event.
 */
async function fetchManyFromRelays(pubkeys: string[]): Promise<NostrProfile[]> {
  if (pubkeys.length === 0) return []
  try {
    const { SimplePool } = await import('nostr-tools/pool')
    const pool = new SimplePool()

    const events = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [0],
      authors: pubkeys,
    })

    pool.close(DEFAULT_RELAYS)

    // Keep the latest event per author.
    const latest = new Map<string, { created_at: number; content: string }>()
    for (const event of events) {
      if (!event?.content) continue
      const prev = latest.get(event.pubkey)
      if (!prev || event.created_at > prev.created_at) {
        latest.set(event.pubkey, {
          created_at: event.created_at,
          content: event.content,
        })
      }
    }

    const profiles: NostrProfile[] = []
    for (const [pubkey, { content }] of latest) {
      const parsed = parseKind0Content(pubkey, content)
      if (parsed) profiles.push(parsed)
    }
    return profiles
  } catch {
    return []
  }
}

// ─── LocalStorage persistence ──────────────────────────────────────────────

function loadCache(): ProfileCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProfileCache
    // Evict stale entries
    const now = Date.now()
    for (const key of Object.keys(parsed)) {
      if (now - parsed[key].fetchedAt > CACHE_TTL_MS) {
        delete parsed[key]
      }
    }
    return parsed
  } catch {
    return {}
  }
}

function saveCache(cache: ProfileCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or unavailable
  }
}
