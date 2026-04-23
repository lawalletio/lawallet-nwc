'use client'

import { useApi } from '@/lib/client/hooks/use-api'
import type {
  EffectiveNwcMode,
  LightningAddressMode,
} from '@/lib/client/hooks/use-wallet-addresses'

export interface AddressData {
  username: string
  pubkey: string
  /** Legacy single-NWC string on the owning User; kept for back-compat. */
  nwcString: string | null
  mode: LightningAddressMode
  redirect: string | null
  nwcConnectionId: string | null
  isPrimary: boolean
  /** Server-derived effective NWC capability for this address. */
  nwcMode: EffectiveNwcMode
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
