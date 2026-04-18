'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export type LightningAddressMode = 'IDLE' | 'ALIAS' | 'CUSTOM_NWC' | 'DEFAULT_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

export interface WalletAddress {
  username: string
  mode: LightningAddressMode
  redirect: string | null
  nwcConnectionId: string | null
  isPrimary: boolean
  /** Effective NWC mode derived server-side; mirrors what users actually get. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
}

export interface WalletNwcConnectionSummary {
  id: string
  connectionString: string
  mode: 'RECEIVE' | 'SEND_RECEIVE'
  isPrimary: boolean
}

export interface WalletAddressDetail {
  address: WalletAddress
  /** All NWCConnections owned by the caller, useful for the CUSTOM_NWC picker. */
  connections: WalletNwcConnectionSummary[]
  /**
   * Pre-resolved NWC URI this address currently routes to, matching the
   * server-side `resolvePaymentRoute` output. `null` for IDLE / ALIAS /
   * unconfigured. Includes the legacy `User.nwc` fallback for
   * DEFAULT_NWC so un-migrated accounts still get a balance.
   */
  effectiveConnectionString: string | null
}

export type AddressInvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED'

export interface AddressInvoice {
  id: string
  amountSats: number
  description: string
  status: AddressInvoiceStatus
  comment: string | null
  paymentHash: string
  createdAt: string
  paidAt: string | null
  expiresAt: string
}

export interface CreateWalletAddressInput {
  username: string
  mode?: LightningAddressMode
}

export interface UpdateWalletAddressInput {
  mode: LightningAddressMode
  redirect?: string | null
  nwcConnectionId?: string | null
}

export interface CreateNwcConnectionInput {
  connectionString: string
  mode?: 'RECEIVE' | 'SEND_RECEIVE'
  isPrimary?: boolean
}

export interface CreatedNwcConnection {
  id: string
  mode: 'RECEIVE' | 'SEND_RECEIVE'
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

/** GET /api/wallet/addresses — caller's own addresses, primary first. */
export function useMyAddresses() {
  return useApi<WalletAddress[]>('/api/wallet/addresses')
}

/** GET /api/wallet/addresses/[username] — single address + connection list. */
export function useMyAddress(username: string | null) {
  return useApi<WalletAddressDetail>(
    username ? `/api/wallet/addresses/${encodeURIComponent(username)}` : null,
  )
}

/**
 * GET /api/wallet/addresses/[username]/invoices — recent LUD-16 invoices
 * minted for this address. Auto-refreshes via the `invoices:updated` SSE
 * event (wired in `getEventTypeForPath`).
 */
export function useAddressInvoices(username: string | null) {
  return useApi<{ invoices: AddressInvoice[] }>(
    username
      ? `/api/wallet/addresses/${encodeURIComponent(username)}/invoices`
      : null,
  )
}

/**
 * Mutation helpers for creating, updating, and promoting addresses to primary.
 * Each call returns the underlying server response so the caller can refresh
 * local state without an extra fetch (the SSE `addresses:updated` event also
 * triggers automatic refresh of `useMyAddresses`).
 */
export function useAddressMutations() {
  const create = useMutation<CreateWalletAddressInput, WalletAddress>()
  const update = useMutation<UpdateWalletAddressInput, WalletAddress>()
  const setPrimary = useMutation<undefined, { success: boolean; username: string }>()
  const createConn = useMutation<CreateNwcConnectionInput, CreatedNwcConnection>()

  return {
    createAddress: (input: CreateWalletAddressInput) =>
      create.mutate('post', '/api/wallet/addresses', input),
    updateAddress: (username: string, input: UpdateWalletAddressInput) =>
      update.mutate(
        'put',
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        input,
      ),
    setAsPrimary: (username: string) =>
      setPrimary.mutate(
        'post',
        `/api/wallet/addresses/${encodeURIComponent(username)}/primary`,
        undefined,
      ),
    /** POST /api/wallet/nwc-connections — create a new NWC connection owned
     *  by the caller. Used by the CUSTOM_NWC inline flow on the edit page. */
    createNwcConnection: (input: CreateNwcConnectionInput) =>
      createConn.mutate('post', '/api/wallet/nwc-connections', input),
    creating: create.loading,
    updating: update.loading,
    settingPrimary: setPrimary.loading,
    creatingConnection: createConn.loading,
    error: create.error ?? update.error ?? setPrimary.error ?? createConn.error,
  }
}
