'use client'

import { useApi } from '@/lib/client/hooks/use-api'

export interface AddressData {
  username: string
  pubkey: string
  nwcString: string | null
  createdAt: string
  updatedAt: string
}

export interface AddressCounts {
  total: number
  withNWC: number
  withoutNWC: number
}

/**
 * Fetch all lightning addresses.
 */
export function useAddresses() {
  return useApi<AddressData[]>('/api/lightning-addresses')
}

/**
 * Fetch lightning address counts/stats.
 */
export function useAddressCounts() {
  return useApi<AddressCounts>('/api/lightning-addresses/counts')
}
