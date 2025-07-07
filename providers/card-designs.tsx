'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { CardDesign } from '@/types/card-design'

interface CardDesignsContextType {
  list: () => Promise<CardDesign[]>
  get: (id: string) => Promise<CardDesign | null>
  count: () => Promise<number>
}

const CardDesignsContext = createContext<CardDesignsContextType | undefined>(
  undefined
)

export const CardDesignsProvider = ({
  children
}: {
  children: React.ReactNode
}) => {
  const list = async () => {
    const res = await fetch('/api/card-designs/list')
    if (!res.ok) throw new Error('Failed to fetch card designs')
    return (await res.json()).map((design: any) => {
      return { ...design, createdAt: new Date(design.createdAt) }
    })
  }
  const get = async (id: string) => {
    const res = await fetch(`/api/card-designs/get/${id}`)
    if (!res.ok) return null
    const design = await res.json()
    return { ...design, createdAt: new Date(design.createdAt) }
  }
  const count = async () => {
    const res = await fetch('/api/card-designs/count')
    if (!res.ok) throw new Error('Failed to fetch card design count')
    const data = await res.json()
    return data.count
  }

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
