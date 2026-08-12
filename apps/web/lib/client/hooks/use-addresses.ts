'use client'

import { useApi } from '@/lib/client/hooks/use-api'
import type {
  EffectiveNwcMode,
  LightningAddressMode
} from '@/lib/client/hooks/use-wallet-addresses'

export interface AddressData {
  username: string
  pubkey: string
  mode: LightningAddressMode
  redirect: string | null
  /** The RemoteWallet this address is bound to (CUSTOM_NWC), or null. */
  remoteWalletId: string | null
  /** Name of the bound RemoteWallet, for display without a second fetch. */
  remoteWalletName: string | null
  isPrimary: boolean
  /** Server-derived effective NWC capability for this address. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
  protocols?: {
    protocols: Record<
      'lud16' | 'nip05' | 'lud21' | 'nip57' | 'lud12',
      boolean | null
    >
    source: 'proxy' | 'wallet' | 'alias' | 'unavailable'
    reason: string | null
    provider: string | null
  }
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
