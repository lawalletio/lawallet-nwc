'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export type LightningAddressMode = 'IDLE' | 'ALIAS' | 'CUSTOM_NWC' | 'DEFAULT_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

export interface WalletAddress {
  username: string
  mode: LightningAddressMode
  redirect: string | null
  /** The RemoteWallet this address is bound to (CUSTOM_NWC), or null. */
  remoteWalletId: string | null
  isPrimary: boolean
  /** Effective NWC mode derived server-side; mirrors what users actually get. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
}

export interface WalletRemoteWalletSummary {
  id: string
  name: string
  type: 'NWC' | 'LND' | 'CLN' | 'BTCPAY'
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'DEAD'
  isDefault: boolean
}

export interface WalletAddressDetail {
  address: WalletAddress
  /** Caller's selectable RemoteWallets, for the CUSTOM_NWC picker. */
  wallets: WalletRemoteWalletSummary[]
  /**
   * Pre-resolved NWC URI this address currently routes to, matching the
   * server-side `resolveWalletRoute` output. `null` for IDLE / ALIAS /
   * unconfigured. Also `null` in the admin read-only view (`isOwner: false`):
   * the connection secret is never surfaced to a non-owner.
   */
  effectiveConnectionString: string | null
  /**
   * Whether the authenticated caller owns this address. `false` when an admin
   * (ADDRESSES_READ) is viewing another user's address — the detail page then
   * renders read-only and withholds the wallet secret. Older responses omit
   * this field; treat missing as owned (the only callers of the pre-admin
   * endpoint were owners).
   */
  isOwner?: boolean
  /** Hex pubkey of the address owner. Present alongside `isOwner`. */
  ownerPubkey?: string
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
  remoteWalletId?: string | null
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
  const remove = useMutation<undefined, { success: boolean; username: string }>()

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
    deleteAddress: (username: string) =>
      remove.mutate(
        'del',
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        undefined,
      ),
    creating: create.loading,
    updating: update.loading,
    settingPrimary: setPrimary.loading,
    deleting: remove.loading,
    error: create.error ?? update.error ?? setPrimary.error ?? remove.error,
  }
}
