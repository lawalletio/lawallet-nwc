'use client'

import React, { createContext, useContext, useMemo, useCallback } from 'react'
import type { LightningAddress } from '@/types/lightning-address'
import { useAPI } from './api'

interface LightningAddressesContextType {
  list: () => Promise<LightningAddress[]>
  count: () => Promise<number>
  getNWCStatusCounts: () => Promise<{ withNWC: number; withoutNWC: number }>
  getUniqueRelays: () => Promise<string[]>
}

const LightningAddressesContext = createContext<
  LightningAddressesContextType | undefined
>(undefined)

export const LightningAddressesProvider = ({
  children
}: {
  children: React.ReactNode
}) => {
  const { get: apiGet } = useAPI()

  const list = useCallback(async () => {
    const response = await apiGet('/api/lightning-addresses')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data.map((address: any) => ({
      ...address,
      createdAt: new Date(address.createdAt)
    }))
  }, [apiGet])

  const getNWCStatusCounts = useCallback(async () => {
    const response = await apiGet('/api/lightning-addresses/counts')
    if (response.error) {
      throw new Error(response.error)
    }
    return {
      withNWC: response.data.withNWC,
      withoutNWC: response.data.withoutNWC
    }
  }, [apiGet])

  const count = useCallback(async () => {
    const counts = await getNWCStatusCounts()
    return counts.withNWC + counts.withoutNWC
  }, [getNWCStatusCounts])

  const getUniqueRelays = useCallback(async () => {
    const response = await apiGet('/api/lightning-addresses/relays')
    if (response.error) {
      throw new Error(response.error)
    }
    return response.data as string[]
  }, [apiGet])

  const value = useMemo<LightningAddressesContextType>(
    () => ({
      list,
      count,
      getNWCStatusCounts,
      getUniqueRelays
    }),
    [list, count, getNWCStatusCounts, getUniqueRelays]
  )

  return (
    <LightningAddressesContext.Provider value={value}>
      {children}
    </LightningAddressesContext.Provider>
  )
}

export function useLightningAddresses() {
  const ctx = useContext(LightningAddressesContext)
  if (!ctx)
    throw new Error(
      'useLightningAddresses must be used within a LightningAddressesProvider'
    )
  return ctx
}
