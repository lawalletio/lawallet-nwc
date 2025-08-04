'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { LightningAddress } from '@/types/lightning-address'

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
  const list = async () => {
    const response = await fetch('/api/lightning-addresses')
    const data = (await response.json()) as LightningAddress[]
    return data.map(address => ({
      ...address,
      createdAt: new Date(address.createdAt)
    }))
  }

  const count = async () => {
    const counts = await getNWCStatusCounts()
    return counts.withNWC + counts.withoutNWC
  }

  const getNWCStatusCounts = async () => {
    const response = await fetch('/api/lightning-addresses/counts')
    const data = await response.json()
    return {
      withNWC: data.withNWC,
      withoutNWC: data.withoutNWC
    }
  }

  const getUniqueRelays = async () => {
    const response = await fetch('/api/lightning-addresses/relays')
    const data = await response.json()
    return data as string[]
  }

  const value = useMemo<LightningAddressesContextType>(
    () => ({
      list,
      count,
      getNWCStatusCounts,
      getUniqueRelays
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
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
