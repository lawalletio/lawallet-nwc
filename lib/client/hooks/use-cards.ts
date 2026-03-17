'use client'

import { useMemo } from 'react'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export interface CardData {
  id: string
  designId: string | null
  design: {
    id: string
    description: string | null
    image: string | null
  } | null
  ntag424: {
    k0: string
    k1: string
    k2: string
    k3: string
    k4: string
    ctr: number
    otc: string | null
  } | null
  lightningAddress: {
    username: string
    pubkey: string
  } | null
  createdAt: string
  updatedAt: string
}

export interface CardCounts {
  total: number
  paired: number
  unpaired: number
  used: number
  unused: number
}

export interface CardFilters {
  paired?: boolean
  used?: boolean
}

/**
 * Fetch cards list with optional filters.
 */
export function useCards(filters?: CardFilters) {
  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    if (filters?.paired !== undefined) params.set('paired', String(filters.paired))
    if (filters?.used !== undefined) params.set('used', String(filters.used))
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }, [filters?.paired, filters?.used])

  return useApi<CardData[]>(`/api/cards${queryParams}`)
}

/**
 * Fetch card counts/stats.
 */
export function useCardCounts() {
  return useApi<CardCounts>('/api/cards/counts')
}

/**
 * Fetch a single card by ID.
 */
export function useCard(id: string | null) {
  return useApi<CardData>(id ? `/api/cards/${id}` : null)
}

/**
 * Mutation hook for creating/deleting cards.
 */
export function useCardMutations() {
  const { mutate, loading, error } = useMutation<{ id: string; designId?: string }>()

  return {
    createCard: (data: { id: string; designId?: string }) =>
      mutate('post', '/api/cards', data),
    deleteCard: (id: string) => mutate('del', `/api/cards/${id}`),
    loading,
    error,
  }
}
