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

  const updateProfile = useCallback(
    (pubkey: string, profile: NostrProfile) => {
      cacheRef.current[pubkey] = profile
      saveCache(cacheRef.current)
    },
    [],
  )

  const value: NostrProfileContextValue = { getProfile, fetchProfile, updateProfile }

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
