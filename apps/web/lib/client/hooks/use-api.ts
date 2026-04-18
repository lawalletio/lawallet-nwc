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
  if (path.startsWith('/api/cards') || path.startsWith('/api/card-designs')) return 'cards:updated'
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

/**
 * Invalidate every cached entry. Called by `AuthProvider.logout` so the
 * next user doesn't see the previous user's data on the first paint.
 * Kept as a named export so the auth layer can hook into it without
 * importing the whole module graph.
 */
export function clearApiCache() {
  apiCache.clear()
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
  const fetchIdRef = useRef(0)

  // SSE invalidation: version bumps trigger refetch
  const eventType = path ? getEventTypeForPath(path) : null
  const sseVersion = useSSEVersion(eventType)

  const fetchData = useCallback(async () => {
    if (!path || status !== 'authenticated') {
      setLoading(false)
      return
    }

    const fetchId = ++fetchIdRef.current
    // Only show the loading skeleton when there's nothing cached to show.
    // Background revalidations stay silent so the page doesn't flash on
    // every navigation.
    if (!apiCache.has(path)) {
      setLoading(true)
    }
    setError(null)

    try {
      const result = await apiClient.get<T>(path)
      // Populate the cache even if a newer fetch superseded this one —
      // the newest response always wins in `fetchIdRef` but we still want
      // all fresh payloads reflected in the cache for the next consumer.
      apiCache.set(path, result)
      // Only update if this is still the latest fetch
      if (fetchId === fetchIdRef.current) {
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

  return { data, loading, error, refetch: fetchData }
}

/**
 * Hook for performing mutations (POST, PUT, DELETE) with loading/error state.
 */
export function useMutation<TInput, TOutput = void>() {
  const { apiClient } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const mutate = useCallback(
    async (
      method: 'post' | 'put' | 'del',
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
