'use client'

import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react'

const CACHE_KEY = 'lawallet-nostr-profiles'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.lawallet.ar',
]

export interface NostrProfile {
  pubkey: string
  name?: string
  displayName?: string
  picture?: string
  about?: string
  nip05?: string
  fetchedAt: number
}

interface ProfileCache {
  [pubkey: string]: NostrProfile
}

interface NostrProfileContextValue {
  getProfile: (pubkey: string) => NostrProfile | null
  fetchProfile: (pubkey: string) => Promise<NostrProfile | null>
}

const NostrProfileContext = createContext<NostrProfileContextValue | null>(null)

export function useNostrProfile(pubkey: string | null): {
  profile: NostrProfile | null
  loading: boolean
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

  return { profile: cachedProfile ?? profile, loading }
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

  const value: NostrProfileContextValue = { getProfile, fetchProfile }

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

    const meta = JSON.parse(event.content)

    return {
      pubkey,
      name: meta.name || meta.username,
      displayName: meta.display_name || meta.displayName,
      picture: meta.picture,
      about: meta.about,
      nip05: meta.nip05,
      fetchedAt: Date.now(),
    }
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
