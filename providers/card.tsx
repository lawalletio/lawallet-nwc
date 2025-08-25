'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { Card } from '@/types/card'
import type { Ntag424 } from '@/types/ntag424'

interface CardsContextType {
  list: () => Promise<Card[]>
  get: (id: string) => Promise<Card | null>
  getPairedCards: () => Promise<Card[]>
  getUnpairedCards: () => Promise<Card[]>
  getUsedCards: () => Promise<Card[]>
  create: (id: string, designId: string) => Promise<Card>
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
  const list = async () => {
    const response = await fetch('/api/cards')
    const data = await response.json()
    return data.map(parseCardDates) as Card[]
  }

  const get = async (id: string) => {
    try {
      const response = await fetch(`/api/cards/${id}`)
      if (!response.ok) return null
      const data = await response.json()
      return parseCardDates(data)
    } catch (error) {
      console.error('Error fetching card:', error)
      return null
    }
  }

  const getPairedCards = async () => {
    const response = await fetch('/api/cards?paired=true')
    const data = await response.json()
    return data.map(parseCardDates) as Card[]
  }

  const getUnpairedCards = async () => {
    const response = await fetch('/api/cards?paired=false')
    const data = await response.json()
    return data.map(parseCardDates) as Card[]
  }

  const getUsedCards = async () => {
    const response = await fetch('/api/cards?used=true')
    const data = await response.json()
    return data.map(parseCardDates) as Card[]
  }

  const create = async (id: string, designId: string) => {
    const response = await fetch('/api/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, designId })
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.reason)
    }

    const data = await response.json()
    return parseCardDates(data)
  }

  const count = async () => {
    const counts = await getStatusCounts()
    return counts.used + counts.unused
  }

  const getStatusCounts = async () => {
    const response = await fetch('/api/cards/counts')
    const data = await response.json()
    return data as {
      paired: number
      unpaired: number
      used: number
      unused: number
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>
}

export function useCards() {
  const ctx = useContext(CardsContext)
  if (!ctx) throw new Error('useCards must be used within a CardsProvider')
  return ctx
}
