'use client'

import { useMemo } from 'react'
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

// The server emits `imageUrl` and has no `updatedAt`; the admin UI uses
// `image` and expects `updatedAt`. Reshape once here so every consumer
// downstream sees the dashboard-native shape.
interface ApiDesign {
  id: string
  description: string | null
  imageUrl: string | null
  createdAt: string
}

function toDesignData(d: ApiDesign): DesignData {
  return {
    id: d.id,
    description: d.description,
    image: d.imageUrl,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
  }
}

/**
 * Fetch all card designs.
 */
export function useDesigns() {
  const result = useApi<ApiDesign[]>('/api/card-designs/list')
  const data = useMemo(
    () => (result.data ? result.data.map(toDesignData) : null),
    [result.data],
  )
  return { ...result, data }
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
