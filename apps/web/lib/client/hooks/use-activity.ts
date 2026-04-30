'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useSSEVersion } from '@/lib/client/hooks/use-sse'

export type ActivityCategory = 'USER' | 'ADDRESS' | 'NWC' | 'INVOICE' | 'CARD' | 'SERVER'
export type ActivityLevel = 'INFO' | 'WARN' | 'ERROR'

export interface ActivityLog {
  id: string
  createdAt: string
  category: ActivityCategory
  level: ActivityLevel
  event: string
  message: string
  reqId: string | null
  userId: string | null
  metadata: Record<string, unknown> | null
}

// Back-compat field used by the existing page; derived from createdAt so the
// table can keep rendering without changing its formatter signature.
export interface ActivityLogView extends ActivityLog {
  timestamp: string
}

export interface ActivityFilters {
  category?: ActivityCategory
  level?: ActivityLevel
  q?: string
}

export interface UseActivityResult {
  data: ActivityLogView[]
  loading: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => Promise<void>
  refetch: () => Promise<void>
}

interface ApiPage {
  items: ActivityLog[]
  nextCursor: string | null
}

function buildQuery(filters: ActivityFilters, cursor: string | null, limit: number): string {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.level) params.set('level', filters.level)
  if (filters.q) params.set('q', filters.q)
  if (cursor) params.set('cursor', cursor)
  params.set('limit', String(limit))
  return params.toString()
}

function toView(log: ActivityLog): ActivityLogView {
  return { ...log, timestamp: log.createdAt }
}

const PAGE_SIZE = 20

/**
 * Cursor-paginated activity feed for the admin dashboard. The first page
 * loads on mount (and refetches when filters change) and `loadMore` appends
 * the next cursor. Subscribes to the `activity:new` SSE event and refetches
 * the first page when one arrives so the table picks up new rows live.
 */
export function useActivity(filters: ActivityFilters = {}): UseActivityResult {
  const { apiClient, status } = useAuth()
  const [data, setData] = useState<ActivityLogView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const fetchIdRef = useRef(0)

  const sseVersion = useSSEVersion('activity:new')

  // Serialize the filters object into a stable key so the fetch effect
  // re-runs when filter values change (not on every render).
  const filterKey = `${filters.category ?? ''}|${filters.level ?? ''}|${filters.q ?? ''}`

  const fetchFirstPage = useCallback(async () => {
    if (status === 'loading' || status === 'unauthenticated') {
      setLoading(false)
      return
    }
    const id = ++fetchIdRef.current
    setLoading(true)
    setError(null)
    try {
      const qs = buildQuery(filters, null, PAGE_SIZE)
      const page = await apiClient.get<ApiPage>(`/api/activity?${qs}`)
      if (id !== fetchIdRef.current) return
      setData(page.items.map(toView))
      setNextCursor(page.nextCursor)
      setHasMore(!!page.nextCursor)
    } catch (err) {
      if (id !== fetchIdRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to load activity'))
    } finally {
      if (id === fetchIdRef.current) setLoading(false)
    }
    // apiClient identity changes on every render through useAuth; we key the
    // effect by filterKey + status instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, filterKey])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading) return
    setLoading(true)
    try {
      const qs = buildQuery(filters, nextCursor, PAGE_SIZE)
      const page = await apiClient.get<ApiPage>(`/api/activity?${qs}`)
      setData(prev => [...prev, ...page.items.map(toView)])
      setNextCursor(page.nextCursor)
      setHasMore(!!page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load more'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loading, filterKey])

  useEffect(() => {
    fetchFirstPage()
  }, [fetchFirstPage])

  // When a new activity arrives via SSE, refetch the first page so we pick up
  // the new row regardless of filter. Cheap (20 rows) and keeps ordering sane
  // without having to reconcile filtered inserts on the client.
  useEffect(() => {
    if (sseVersion === 0) return
    fetchFirstPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sseVersion])

  return { data, loading, error, hasMore, loadMore, refetch: fetchFirstPage }
}
