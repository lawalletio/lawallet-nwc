'use client'

import React, { createContext, useContext, useMemo, useCallback } from 'react'
import type { Card } from '@/types/card'
import type { Ntag424 } from '@/types/ntag424'
import { useAPI } from './api'

interface CardsContextType {
  list: () => Promise<Card[]>
  get: (id: string) => Promise<Card | null>
  getPairedCards: () => Promise<Card[]>
  getUnpairedCards: () => Promise<Card[]>
  getUsedCards: () => Promise<Card[]>
  create: (id: string, designId: string) => Promise<Card>
  delete: (id: string) => Promise<void>
  count: () => Promise<number>
  getStatusCounts: () => Promise<{
    paired: number
    unpaired: number
    used: number
    unused: number
  }>
}

const CardsContext = createContext<CardsContextType | undefined>(undefined)

// Helper to parse dates in card data
const parseCardDates = (card: any): Card => {
  const ntag424: Ntag424 | undefined = card.ntag424
    ? {
        ...card.ntag424,
        createdAt: new Date(card.ntag424.createdAt)
      }
    : undefined

  return {
    ...card,
    createdAt: new Date(card.createdAt),
    lastUsedAt: card.lastUsedAt ? new Date(card.lastUsedAt) : undefined,
    ntag424
  }
}

export const CardsProvider = ({ children }: { children: React.ReactNode }) => {
  const { get: apiGet, post: apiPost, delete: deleteRequest } = useAPI()
  const list = useCallback(async () => {
    const response = await apiGet('/api/cards')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data.map(parseCardDates) as Card[]
  }, [apiGet])

  const get = useCallback(
    async (id: string) => {
      try {
        const response = await apiGet(`/api/cards/${id}`)
        if (response.error) return null
        return parseCardDates(response.data)
      } catch (error) {
        console.error('Error fetching card:', error)
        return null
      }
    },
    [apiGet]
  )

  const getPairedCards = useCallback(async () => {
    const response = await apiGet('/api/cards?paired=true')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data.map(parseCardDates) as Card[]
  }, [apiGet])

  const getUnpairedCards = useCallback(async () => {
    const response = await apiGet('/api/cards?paired=false')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data.map(parseCardDates) as Card[]
  }, [apiGet])

  const getUsedCards = useCallback(async () => {
    const response = await apiGet('/api/cards?used=true')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data.map(parseCardDates) as Card[]
  }, [apiGet])

  const create = useCallback(
    async (id: string, designId: string) => {
      const response = await apiPost('/api/cards', {
        id,
        designId
      })

      if (response.error) {
        throw new Error(response.error)
      }

      return parseCardDates(response.data)
    },
    [apiPost]
  )

  const deleteCard = useCallback(
    async (id: string) => {
      const response = await deleteRequest(`/api/cards/${id}`)

      if (response.error) {
        throw new Error(response.error)
      }
    },
    [deleteRequest]
  )

  const getStatusCounts = useCallback(async () => {
    const response = await apiGet('/api/cards/counts')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data as {
      paired: number
      unpaired: number
      used: number
      unused: number
    }
  }, [apiGet])

  const count = useCallback(async () => {
    const counts = await getStatusCounts()
    return counts.used + counts.unused
  }, [getStatusCounts])

  const value = useMemo<CardsContextType>(
    () => ({
      list,
      get,
      getPairedCards,
      getUnpairedCards,
      getUsedCards,
      create,
      delete: deleteCard,
      count,
      getStatusCounts
    }),
    [
      list,
      get,
      getPairedCards,
      getUnpairedCards,
      getUsedCards,
      create,
      deleteCard,
      count,
      getStatusCounts
    ]
  )

  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>
}

export function useCards() {
  const ctx = useContext(CardsContext)
  if (!ctx) throw new Error('useCards must be used within a CardsProvider')
  return ctx
}
