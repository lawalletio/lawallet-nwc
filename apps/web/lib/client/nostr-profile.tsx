'use client'

import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import {
  NOSTR_PROFILE_CACHE_TTL_MS as CACHE_TTL_MS,
  normalizeNostrPubkey,
  type NostrProfile,
} from '@/lib/nostr/profile'

export { DEFAULT_NOSTR_RELAYS, parseKind0Content } from '@/lib/nostr/profile'
export type { NostrProfile } from '@/lib/nostr/profile'

const CACHE_KEY = 'lawallet-nostr-profiles'

interface ProfileCache {
  [pubkey: string]: NostrProfile
}

interface FetchOptions {
  force?: boolean
}

interface NostrProfileContextValue {
  getProfile: (pubkey: string) => NostrProfile | null
  fetchProfile: (pubkey: string, options?: FetchOptions) => Promise<NostrProfile | null>
  /**
   * Resolve many pubkeys in a single server round-trip. Pubkeys already fresh
   * in the local cache (or in flight) are skipped unless `force` is true.
   */
  fetchProfiles: (pubkeys: string[], options?: FetchOptions) => Promise<Record<string, NostrProfile>>
  /**
   * Seed a freshly-signed kind-0 straight into the cache. Used after the
   * user publishes their own profile so the UI reflects the change
   * immediately without waiting on relay round-trips.
   */
  updateProfile: (pubkey: string, profile: NostrProfile) => void
}

interface NostrProfilesResponse {
  profiles: NostrProfile[]
}

const NostrProfileContext = createContext<NostrProfileContextValue | null>(null)

export function useNostrProfile(
  pubkey: string | null,
  options: FetchOptions = {},
): {
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
  const force = options.force ?? false

  // Stale-while-revalidate: show cached immediately, fetch fresh in background
  // when forced or when the local cache is missing/stale.
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

    const currentCached = ctx.getProfile(pubkey)
    if (!currentCached) {
      queueMicrotask(() => {
        if (!cancelled) setLoading(true)
      })
    }

    ctx.fetchProfile(pubkey, { force })
      .then(result => {
        if (!cancelled && result) {
          setProfile(result)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [pubkey, ctx, force])

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
 * the local cache, then revalidates missing/stale rows with one batched API
 * request. Returns a `pubkey -> profile | null` map plus a `loading` flag.
 */
export function useNostrProfiles(pubkeys: string[]): {
  profiles: Record<string, NostrProfile | null>
  loading: boolean
} {
  const ctx = useContext(NostrProfileContext)
  if (!ctx) {
    throw new Error('useNostrProfiles must be used within a NostrProfileProvider')
  }

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
          setProfiles(prev => {
            const next = { ...prev, ...fetched }
            for (const requested of key ? key.split(',') : []) {
              const normalized = normalizeNostrPubkey(requested)
              const profile = normalized ? fetched[normalized.pubkey] : null
              if (profile) next[requested] = profile
            }
            return next
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx])

  return { profiles, loading }
}

export function NostrProfileProvider({ children }: { children: React.ReactNode }) {
  const { apiClient, status } = useAuth()
  const cacheRef = useRef<ProfileCache>(loadCache())
  const inflightRef = useRef<Map<string, Promise<NostrProfile | null>>>(new Map())

  const getProfile = useCallback((pubkey: string): NostrProfile | null => {
    const normalized = normalizeNostrPubkey(pubkey)
    if (!normalized) return null
    const cached = cacheRef.current[normalized.pubkey]
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached
    }
    return null
  }, [])

  const fetchProfilesFromApi = useCallback(
    async (pubkeys: string[], force: boolean): Promise<Record<string, NostrProfile>> => {
      if (status !== 'authenticated' || pubkeys.length === 0) return {}
      let response: NostrProfilesResponse
      try {
        response = await apiClient.post<NostrProfilesResponse>('/api/nostr/profiles', {
          pubkeys,
          force,
        })
      } catch (err) {
        console.warn('Failed to refresh Nostr profiles from server cache', err)
        return {}
      }
      const profiles = response.profiles ?? []
      for (const profile of profiles) {
        cacheRef.current[profile.pubkey] = profile
      }
      if (profiles.length > 0) saveCache(cacheRef.current)
      return Object.fromEntries(profiles.map(profile => [profile.pubkey, profile]))
    },
    [apiClient, status],
  )

  const fetchProfile = useCallback(
    async (pubkey: string, options: FetchOptions = {}): Promise<NostrProfile | null> => {
      const normalized = normalizeNostrPubkey(pubkey)
      if (!normalized) return null

      if (!options.force) {
        const cached = getProfile(normalized.pubkey)
        if (cached) return cached
      }

      const inflightKey = `${normalized.pubkey}:${options.force ? 'force' : 'normal'}`
      const existing = inflightRef.current.get(inflightKey)
      if (existing) return existing

      const promise = fetchProfilesFromApi([normalized.pubkey], options.force ?? false)
        .then(map => map[normalized.pubkey] ?? null)
        .finally(() => {
          inflightRef.current.delete(inflightKey)
        })

      inflightRef.current.set(inflightKey, promise)
      return promise
    },
    [fetchProfilesFromApi, getProfile],
  )

  const fetchProfiles = useCallback(
    async (
      pubkeys: string[],
      options: FetchOptions = {},
    ): Promise<Record<string, NostrProfile>> => {
      const unique = Array.from(
        new Map(
          pubkeys
            .map(pk => normalizeNostrPubkey(pk))
            .filter((pk): pk is NonNullable<typeof pk> => Boolean(pk))
            .map(pk => [pk.pubkey, pk]),
        ).values(),
      )

      const missing = unique.filter(pk => {
        if (options.force) return true
        const cached = getProfile(pk.pubkey)
        const inflight = inflightRef.current.has(`${pk.pubkey}:normal`)
        return !cached && !inflight
      })

      if (missing.length === 0) return {}

      const batch = fetchProfilesFromApi(
        missing.map(pk => pk.pubkey),
        options.force ?? false,
      )

      for (const pk of missing) {
        const inflightKey = `${pk.pubkey}:${options.force ? 'force' : 'normal'}`
        inflightRef.current.set(
          inflightKey,
          batch.then(map => map[pk.pubkey] ?? null),
        )
      }

      try {
        return await batch
      } finally {
        for (const pk of missing) {
          inflightRef.current.delete(`${pk.pubkey}:${options.force ? 'force' : 'normal'}`)
        }
      }
    },
    [fetchProfilesFromApi, getProfile],
  )

  const updateProfile = useCallback(
    (pubkey: string, profile: NostrProfile) => {
      const normalized = normalizeNostrPubkey(pubkey)
      if (!normalized) return
      cacheRef.current[normalized.pubkey] = profile
      saveCache(cacheRef.current)
      if (status === 'authenticated') {
        void fetchProfilesFromApi([normalized.pubkey], true).catch(() => {
          // Server-side cache refresh is best-effort after a local publish.
        })
      }
    },
    [fetchProfilesFromApi, status],
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

function loadCache(): ProfileCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProfileCache
    const now = Date.now()
    const normalizedCache: ProfileCache = {}

    for (const [key, profile] of Object.entries(parsed)) {
      const normalized = normalizeNostrPubkey(profile.pubkey || key)
      if (!normalized) continue
      if (now - profile.fetchedAt > CACHE_TTL_MS) continue
      normalizedCache[normalized.pubkey] = {
        ...profile,
        pubkey: normalized.pubkey,
        npub: profile.npub ?? normalized.npub,
      }
    }

    return normalizedCache
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
