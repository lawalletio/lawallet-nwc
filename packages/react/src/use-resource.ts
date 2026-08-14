'use client'

import type { SSEEventType } from '@lawallet-nwc/sdk'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useLaWalletContext } from './provider'

export interface ResourceState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Cached fetch bound to the provider's store, with cache-until-invalidated
 * semantics: a loaded entry is reused by every hook on the same key until a
 * mutation invalidates it or a declared SSE event type fires. Pass `null` as
 * the key to pause (e.g. while unauthenticated).
 */
export function useResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  eventTypes?: readonly SSEEventType[]
): ResourceState<T> {
  const { store, sseVersions, auth } = useLaWalletContext()

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const subscribe = useCallback(
    (listener: () => void) => (key ? store.subscribe(key, listener) : () => {}),
    [key, store]
  )
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? store.get(key) : null),
    () => null
  )

  // The join of the versions this hook cares about — changes force a refetch.
  const version = (eventTypes ?? [])
    .map(type => sseVersions[type] ?? 0)
    .join(',')

  // Deliberately dependency-less: runs after every render, but only actually
  // fetches when (a) the entry is empty (first mount or invalidated by a
  // mutation — deletion notifies subscribers, which re-renders us into here),
  // or (b) an SSE version / the identity changed. `store.fetch` dedupes
  // concurrent calls, and a loading/errored entry is left alone.
  const lastForceKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!key) return
    const forceKey = `${key}|${version}|${auth.pubkey ?? ''}`
    const changed =
      lastForceKeyRef.current !== null && lastForceKeyRef.current !== forceKey
    lastForceKeyRef.current = forceKey

    const current = store.get(key)
    const empty =
      current.data === undefined && !current.loading && current.error === null
    if (changed || empty) {
      void store.fetch(key, () => fetcherRef.current())
    }
  })

  const refetch = useCallback(async () => {
    if (!key) return
    await store.fetch(key, () => fetcherRef.current())
  }, [key, store])

  // An empty entry with an active key means a fetch is imminent (the effect
  // above fires right after this render) — report it as loading so consumers
  // never see a false "empty" state on first paint.
  const firstLoadPending =
    entry !== null &&
    entry.data === undefined &&
    entry.error === null &&
    !entry.loading

  return {
    data: (entry?.data as T | undefined) ?? null,
    loading: (entry?.loading ?? false) || firstLoadPending,
    error: entry?.error ?? null,
    refetch
  }
}
