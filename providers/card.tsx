'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { Card } from '@/types/card'
import { mockCardData } from '@/mocks/card'

interface CardsContextType {
  list: () => Card[]
  get: (id: string) => Card | null
  getPairedCards: () => Card[]
  getUnpairedCards: () => Card[]
  getUsedCards: () => Card[]
  create: (id: string, designId: string) => Card
  count: () => number
  getStatusCounts: () => {
    paired: number
    unpaired: number
    used: number
    unused: number
  }
}

const CardsContext = createContext<CardsContextType | undefined>(undefined)

export const CardsProvider = ({ children }: { children: React.ReactNode }) => {
  const list = () => mockCardData

  const get = (id: string) => mockCardData.find(card => card.id === id) || null

  const getPairedCards = () =>
    mockCardData.filter(card => card.ntag424 !== undefined)

  const getUnpairedCards = () =>
    mockCardData.filter(card => card.ntag424 === undefined)

  const getUsedCards = () =>
    mockCardData.filter(card => card.lastUsedAt !== undefined)

  const create = (id: string, designId: string) => {
    // This is a mock; in a real app, you'd push to state or call an API
    return {
      ...mockCardData[0],
      id,
      design: { ...mockCardData[0].design, id: designId }
    }
  }

  const count = () => mockCardData.length

  const getStatusCounts = () => ({
    paired: getPairedCards().length,
    unpaired: getUnpairedCards().length,
    used: getUsedCards().length,
    unused: mockCardData.filter(card => card.lastUsedAt === undefined).length
  })

  const value = useMemo<CardsContextType>(
    () => ({
      list,
      get,
      getPairedCards,
      getUnpairedCards,
      getUsedCards,
      create,
      count,
      getStatusCounts
    }),
    []
  )

  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>
}

export function useCards() {
  const ctx = useContext(CardsContext)
  if (!ctx) throw new Error('useCards must be used within a CardsProvider')
  return ctx
}
