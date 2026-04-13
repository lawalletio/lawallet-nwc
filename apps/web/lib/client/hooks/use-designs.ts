'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export interface DesignData {
  id: string
  description: string | null
  image: string | null
  createdAt: string
  updatedAt: string
}

export interface DesignCount {
  count: number
}

/**
 * Fetch all card designs.
 */
export function useDesigns() {
  return useApi<DesignData[]>('/api/card-designs/list')
}

/**
 * Fetch card design count.
 */
export function useDesignCount() {
  return useApi<DesignCount>('/api/card-designs/count')
}

/**
 * Mutation hook for importing designs.
 */
export function useDesignMutations() {
  const { mutate, loading, error } = useMutation()

  return {
    importDesigns: () => mutate('post', '/api/card-designs/import'),
    loading,
    error,
  }
}
