'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { CardDesign } from '@/types/card-design'
import { mockCardDesignData } from '@/mocks/card-design'

interface CardDesignsContextType {
  list: () => CardDesign[]
  get: (id: string) => CardDesign | null
  count: () => number
}

const CardDesignsContext = createContext<CardDesignsContextType | undefined>(
  undefined
)

export const CardDesignsProvider = ({
  children
}: {
  children: React.ReactNode
}) => {
  const list = () => mockCardDesignData
  const get = (id: string) =>
    mockCardDesignData.find(design => design.id === id) || null
  const count = () => mockCardDesignData.length

  const value = useMemo<CardDesignsContextType>(
    () => ({
      list,
      get,
      count
    }),
    []
  )

  return (
    <CardDesignsContext.Provider value={value}>
      {children}
    </CardDesignsContext.Provider>
  )
}

export function useCardDesigns() {
  const ctx = useContext(CardDesignsContext)
  if (!ctx)
    throw new Error('useCardDesigns must be used within a CardDesignsProvider')
  return ctx
}
