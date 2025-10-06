'use client'

import React, { createContext, useContext, useMemo, useCallback } from 'react'
import type { CardDesign } from '@/types/card-design'
import { useAPI } from '@/providers/api'

interface CardDesignsContextType {
  list: () => Promise<CardDesign[]>
  get: (id: string) => Promise<CardDesign | null>
  count: () => Promise<number>
  import: () => Promise<{
    success: boolean
    message: string
    imported: number
    skipped: number
    designs?: Array<{
      id: string
      imageUrl: string
      description: string
      createdAt: Date
    }>
  }>
}

const CardDesignsContext = createContext<CardDesignsContextType | undefined>(
  undefined
)

export const CardDesignsProvider = ({
  children
}: {
  children: React.ReactNode
}) => {
  const { get: apiGet, post: apiPost } = useAPI()

  const list = useCallback(async () => {
    const response = await apiGet('/api/card-designs/list')
    if (response.error) throw new Error(response.error)
    return response.data.map((design: any) => {
      return { ...design, createdAt: new Date(design.createdAt) }
    })
  }, [apiGet])

  const get = useCallback(
    async (id: string) => {
      const response = await apiGet(`/api/card-designs/get/${id}`)
      if (response.error) return null
      return { ...response.data, createdAt: new Date(response.data.createdAt) }
    },
    [apiGet]
  )

  const count = useCallback(async () => {
    const response = await apiGet('/api/card-designs/count')
    if (response.error) throw new Error(response.error)
    return response.data.count
  }, [apiGet])

  const importDesigns = useCallback(async () => {
    const response = await apiPost('/api/card-designs/import')

    if (response.error) {
      throw new Error(response.error)
    }

    // Convert createdAt strings to Date objects if designs are returned
    if (response.data?.designs) {
      response.data.designs = response.data.designs.map((design: any) => ({
        ...design,
        createdAt: new Date(design.createdAt)
      }))
    }

    return response.data
  }, [apiPost])

  const value = useMemo<CardDesignsContextType>(
    () => ({
      list,
      get,
      count,
      import: importDesigns
    }),
    [list, get, count, importDesigns]
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
