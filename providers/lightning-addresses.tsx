'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { LightningAddress } from '@/types/lightning-address'
import { mockLightningAddressData } from '@/mocks/lightning-address'

interface LightningAddressesContextType {
  list: () => LightningAddress[]
  count: () => number
  getNWCStatusCounts: () => { withNWC: number; withoutNWC: number }
  getUniqueRelays: () => string[]
}

const LightningAddressesContext = createContext<
  LightningAddressesContextType | undefined
>(undefined)

export const LightningAddressesProvider = ({
  children
}: {
  children: React.ReactNode
}) => {
  const list = () => mockLightningAddressData
  const count = () => mockLightningAddressData.length
  const getNWCStatusCounts = () => ({
    withNWC: mockLightningAddressData.filter(addr => addr.nwc !== undefined)
      .length,
    withoutNWC: mockLightningAddressData.filter(addr => addr.nwc === undefined)
      .length
  })
  const getUniqueRelays = () => {
    const relays = new Set<string>()
    mockLightningAddressData.forEach(addr => {
      if (addr.nwc) {
        try {
          const url = new URL(addr.nwc)
          const relayParam = url.searchParams.get('relay')
          if (relayParam) {
            relays.add(decodeURIComponent(relayParam))
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }
    })
    return Array.from(relays)
  }

  const value = useMemo<LightningAddressesContextType>(
    () => ({
      list,
      count,
      getNWCStatusCounts,
      getUniqueRelays
    }),
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
