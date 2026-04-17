'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useSSEVersion, type SSEEventType } from '@/lib/client/hooks/use-sse'

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Maps an API path to its corresponding SSE event type for auto-refresh.
 */
function getEventTypeForPath(path: string): SSEEventType | null {
  if (path.startsWith('/api/lightning-addresses')) return 'addresses:updated'
  if (path.startsWith('/api/wallet/addresses')) return 'addresses:updated'
  if (path.startsWith('/api/cards') || path.startsWith('/api/card-designs')) return 'cards:updated'
  if (path.startsWith('/api/settings')) return 'settings:updated'
  if (path.startsWith('/api/invoices')) return 'invoices:updated'
  if (path.startsWith('/api/users')) return 'users:updated'
  return null
}

/**
 * Generic hook for fetching data from authenticated API endpoints.
 * Automatically refetches when:
 * - The path changes
 * - An SSE event invalidates the data (real-time updates)
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
  const { apiClient, status } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
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
    setLoading(true)
    setError(null)

    try {
      const result = await apiClient.get<T>(path)
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
