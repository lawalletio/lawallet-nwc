'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useSSEVersion, type SSEEventType } from '@/lib/client/hooks/use-sse'

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  /**
   * Re-runs the fetch. Returns a Promise that resolves once the new data
   * (or error) has been committed to state, so callers who want to hold a
   * local "busy" flag across both a mutation *and* the subsequent refetch
   * can `await` this to avoid the button briefly flickering enabled
   * between the two phases.
   */
  refetch: () => Promise<void>
}

/**
 * Maps an API path to its corresponding SSE event type for auto-refresh.
 */
function getEventTypeForPath(path: string): SSEEventType | null {
  if (path.startsWith('/api/lightning-addresses')) return 'addresses:updated'
  // Per-address invoices feed has to match before the generic
  // `/api/wallet/addresses` rule below — otherwise invoice refreshes would
  // be tied to the `addresses:updated` event instead of `invoices:updated`.
  if (/^\/api\/wallet\/addresses\/[^/]+\/invoices/.test(path)) return 'invoices:updated'
  if (path.startsWith('/api/wallet/addresses')) return 'addresses:updated'
  // The caller's own cards feed mirrors the admin `/api/cards` → `cards:updated`
  // so a newly paired/unpaired card refreshes the Connection Map + Cards view.
  if (path.startsWith('/api/wallet/cards')) return 'cards:updated'
  // `/api/card-designs` must come *before* the `/api/cards` rule because
  // `cards`.startsWith test would otherwise claim it. Designs emit their
  // own `designs:updated` bus event; wiring them to `cards:updated` meant
  // the designs grid and the Create-Card design picker never refetched
  // after a new design was uploaded.
  if (path.startsWith('/api/card-designs')) return 'designs:updated'
  if (path.startsWith('/api/cards')) return 'cards:updated'
  if (path.startsWith('/api/settings')) return 'settings:updated'
  if (path.startsWith('/api/invoices')) return 'invoices:updated'
  if (path.startsWith('/api/users')) return 'users:updated'
  return null
}

/**
 * Module-level stale-while-revalidate cache for GETs.
 *
 * Without this, every remount of `useApi` (e.g. navigating between pages,
 * or mounting two consumers of the same endpoint simultaneously — topbar +
 * sidebar both call `useSettings` for the brand logo) triggers its own
 * independent fetch and flashes through loading state. The logo's Blossom
 * URL is stable across navigations, so the image itself is already browser-
 * cached; the flicker comes from `/api/settings` being re-requested and
 * the component spending a frame in its skeleton branch.
 *
 * Design notes:
 *   - Keyed by URL path only. Auth is checked per call via `useAuth()`, and
 *     the cache is wiped on logout (see `_clearApiCache` subscriber below).
 *   - Entries are in-memory only. A page reload re-fetches everything —
 *     that's fine; HTTP-level caching is the server's concern.
 *   - Stale-while-revalidate semantics: cache hits render immediately with
 *     `loading=false`, then the background revalidation updates state if
 *     the response changed. SSE invalidation still drives real-time
 *     refetches via `useSSEVersion`, same as before.
 */
const apiCache = new Map<string, unknown>()
const apiInflight = new Map<string, Promise<unknown>>()
const apiInvalidationVersions = new Map<string, number>()
const API_CACHE_INVALIDATED_EVENT = 'lawallet:api-cache-invalidated'
let apiCacheEpoch = 0

function fetchWithDedupe<T>(path: string, loader: () => Promise<T>): Promise<T> {
  const existing = apiInflight.get(path) as Promise<T> | undefined
  if (existing) return existing

  let next: Promise<T>
  next = loader().finally(() => {
    if (apiInflight.get(path) === next) {
      apiInflight.delete(path)
    }
  })
  apiInflight.set(path, next)
  return next
}

function getInvalidationVersion(path: string) {
  return apiInvalidationVersions.get(path) ?? 0
}

/**
 * Invalidate every cached entry. Called by `AuthProvider.logout` so the
 * next user doesn't see the previous user's data on the first paint.
 * Kept as a named export so the auth layer can hook into it without
 * importing the whole module graph.
 */
export function clearApiCache() {
  apiCache.clear()
  apiInflight.clear()
  apiInvalidationVersions.clear()
  apiCacheEpoch += 1
}

/**
 * Invalidate a single cached path. Use this after a mutation whose result
 * isn't visible in the response itself but does change a different
 * endpoint's payload (e.g. claiming a Lightning Address changes
 * /api/users/me, even though the claim hit /api/invoices/.../claim).
 * Without this, the next mount of a consumer of `path` would render with
 * stale cached data for one frame before the SSE-driven refetch swaps it.
 */
export function invalidateApiPath(path: string) {
  apiCache.delete(path)
  apiInflight.delete(path)
  apiInvalidationVersions.set(path, getInvalidationVersion(path) + 1)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(API_CACHE_INVALIDATED_EVENT, { detail: { path } }),
    )
  }
}

/**
 * Generic hook for fetching data from authenticated API endpoints.
 * Automatically refetches when:
 * - The path changes
 * - An SSE event invalidates the data (real-time updates)
 *
 * Uses the module-level `apiCache` as a synchronous initial value so that
 * repeat consumers of the same path skip the loading flash entirely.
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
  const { apiClient, status } = useAuth()
  // Initialise from the cache synchronously. Without this, even a cache
  // hit would render one frame of `data=null / loading=true` before the
  // effect runs and the cached value is applied — defeating the point.
  const [data, setData] = useState<T | null>(() =>
    path ? ((apiCache.get(path) as T | undefined) ?? null) : null,
  )
  // Only block with a skeleton when we have nothing to show. A cache hit
  // renders immediately; the fetch still runs in the background and
  // updates silently if the payload changed.
  const [loading, setLoading] = useState(
    path ? !apiCache.has(path) : false,
  )
  const [error, setError] = useState<Error | null>(null)
  const dataRef = useRef(data)
  const dataPathRef = useRef<string | null>(data !== null ? path : null)
  const fetchIdRef = useRef(0)

  // SSE invalidation: version bumps trigger refetch
  const eventType = path ? getEventTypeForPath(path) : null
  const sseVersion = useSSEVersion(eventType)

  const fetchData = useCallback(async () => {
    // Wait until auth has settled — firing during the `loading` window would
    // race with the JWT becoming available and trigger a spurious no-auth
    // request. `unauthenticated` is fine: the api-client sends no
    // Authorization header, so endpoints that expose a public subset (notably
    // `/api/settings` with the community branding) can still hydrate the UI
    // shown before sign-in (e.g. the login page logo). Protected endpoints
    // simply return 401 — same behavior as before.
    if (!path || status === 'loading') {
      setLoading(false)
      return
    }

    const fetchId = ++fetchIdRef.current
    const hasCachedData = apiCache.has(path)
    const hasCurrentData = dataPathRef.current === path && dataRef.current !== null

    // Only show the loading skeleton when there's truly nothing to show for
    // this path. Manual invalidations delete the cache so the next request
    // refetches, but mounted consumers can keep rendering their current data.
    if (hasCachedData) {
      const cachedData = apiCache.get(path) as T
      dataRef.current = cachedData
      dataPathRef.current = path
      setData(cachedData)
      setLoading(false)
    } else if (!hasCurrentData) {
      if (dataPathRef.current !== path && dataRef.current !== null) {
        dataRef.current = null
        dataPathRef.current = path
        setData(null)
      }
      setLoading(true)
    } else {
      setLoading(false)
    }
    setError(null)

    try {
      const requestEpoch = apiCacheEpoch
      const requestVersion = getInvalidationVersion(path)
      const result = await fetchWithDedupe(path, () => apiClient.get<T>(path))
      const responseIsCurrent =
        requestEpoch === apiCacheEpoch &&
        requestVersion === getInvalidationVersion(path)

      if (!responseIsCurrent) return
      // Keep the shared cache in the same invalidation generation as this
      // request. A newer fetch for this hook can still supersede the state
      // update below via `fetchIdRef`.
      apiCache.set(path, result)
      // Only update if this is still the latest fetch
      if (fetchId === fetchIdRef.current) {
        dataRef.current = result
        dataPathRef.current = path
        setData(result)
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [path, apiClient, status])

  useEffect(() => {
    fetchData()
  }, [fetchData, sseVersion])

  useEffect(() => {
    if (!path || typeof window === 'undefined') return

    function handleInvalidation(event: Event) {
      const invalidatedPath = (event as CustomEvent<{ path?: string }>).detail?.path
      if (invalidatedPath === path) {
        void fetchData()
      }
    }

    window.addEventListener(API_CACHE_INVALIDATED_EVENT, handleInvalidation)
    return () => window.removeEventListener(API_CACHE_INVALIDATED_EVENT, handleInvalidation)
  }, [fetchData, path])

  return { data, loading, error, refetch: fetchData }
}

/**
 * Hook for performing mutations (POST, PUT, PATCH, DELETE) with loading/error state.
 */
export function useMutation<TInput, TOutput = void>() {
  const { apiClient } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const mutate = useCallback(
    async (
      method: 'post' | 'put' | 'patch' | 'del',
      path: string,
      body?: TInput
    ): Promise<TOutput> => {
      setLoading(true)
      setError(null)

      try {
        const result = await apiClient[method]<TOutput>(path, body)
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [apiClient]
  )

  return { mutate, loading, error }
}
