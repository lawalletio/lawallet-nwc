'use client'

import {
  invalidateApiPath,
  useApi,
  useMutation
} from '@/lib/client/hooks/use-api'

export type LightningAddressMode =
  | 'IDLE'
  | 'ALIAS'
  | 'PROXY_ALIAS'
  | 'CUSTOM_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

export interface WalletAddress {
  username: string
  mode: LightningAddressMode
  redirect: string | null
  /** The RemoteWallet this address is bound to (CUSTOM_NWC), or null. */
  remoteWalletId: string | null
  /** Name of the bound RemoteWallet, for display without a second fetch. */
  remoteWalletName: string | null
  isPrimary: boolean
  /** Effective NWC mode derived server-side; mirrors what users actually get. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
  /** Protocols this address exposes to a payer. */
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
   * PROXY_ALIAS /
   * unconfigured. Also `null` in the admin read-only view (`isOwner: false`):
   * the connection secret is never surfaced to a non-owner.
   */
  effectiveConnectionString: string | null
  /** Whether operators currently allow deferred Lightning Address forwarding. */
  deferredProxyEnabled: boolean
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
  /** Capabilities currently exposed by this address's public LUD-16 endpoint. */
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

export type AddressInvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED'

export interface AddressProxyAttempt {
  id: string
  attemptNo: number
  requestId: string
  bolt11: string
  paymentHash: string
  amountMsats: string
  status: string
  routingFeeMsats: string | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface AddressProxyPayment {
  id: string
  status: string
  destination: string
  feeBps: number
  grossAmountMsats: string
  serviceFeeMsats: string
  destinationAmountMsats: string
  forwardedAmountMsats: string | null
  routingFeeMsats: string | null
  sourcePaidAt: string | null
  forwardedAt: string | null
  receiptEventId: string | null
  receiptPublishedAt: string | null
  retryCount: number
  nextRetryAt: string
  leaseExpiresAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  attemptCount: number
  attempts: AddressProxyAttempt[]
}

export interface AddressInvoice {
  id: string
  amountSats: number
  amountMsats: string
  bolt11: string
  description: string
  status: AddressInvoiceStatus
  comment: string | null
  paymentHash: string
  createdAt: string
  paidAt: string | null
  expiresAt: string
  proxy: AddressProxyPayment | null
}

export interface ProxyPendingBalance {
  /** Net amount still owed to destinations, after retained service fees. */
  pendingAmountMsats: string
  pendingPaymentCount: number
  blockedPaymentCount: number
  inFlightPaymentCount: number
  oldestPendingAt: string | null
  destination: string | null
}

export interface ProxyPendingForwardResult {
  success: boolean
  queued: number
  reconciliation: {
    claimed: number
    completed: number
    failed: number
  }
}

export type ProxyForwardingCommand =
  | { action: 'retry' }
  | { action: 'change_destination'; destination: string }

export interface ProxyForwardingCommandResult {
  success: boolean
  action: ProxyForwardingCommand['action']
  reconciliation?: {
    claimed: number
    completed: number
    failed: number
  }
  payment: {
    id: string
    status: string
    destination: string
    lastError: string | null
  } | null
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

export type AliasProbeCheckKey = 'lud16' | 'lud21' | 'nip57' | 'lud12'

export interface AliasProbeCheckResult {
  ok: boolean
  message: string
}

export interface AliasProbeResponse {
  address: string
  canSave: boolean
  checks: Record<AliasProbeCheckKey, AliasProbeCheckResult>
}

/** GET /api/wallet/addresses — caller's own addresses, primary first. */
export function useMyAddresses() {
  return useApi<WalletAddress[]>('/api/wallet/addresses')
}

/** GET /api/wallet/addresses/[username] — single address + connection list. */
export function useMyAddress(username: string | null) {
  return useApi<WalletAddressDetail>(
    username ? `/api/wallet/addresses/${encodeURIComponent(username)}` : null
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
      : null
  )
}

/** Live deferred-proxy liability, refreshed by invoice settlement SSE events. */
export function useProxyPendingBalance(username: string | null) {
  return useApi<ProxyPendingBalance>(
    username
      ? `/api/wallet/addresses/${encodeURIComponent(username)}/proxy-balance`
      : null
  )
}

/**
 * Releases every safe pending settlement for immediate reconciliation. The
 * server remains authoritative about whether another worker or an ambiguous
 * outgoing attempt already owns any of the funds.
 */
export function useProxyPendingBalanceMutation(username: string) {
  const mutation = useMutation<undefined, ProxyPendingForwardResult>()
  const usernameSegment = encodeURIComponent(username)
  const balancePath = `/api/wallet/addresses/${usernameSegment}/proxy-balance`
  const invoicesPath = `/api/wallet/addresses/${usernameSegment}/invoices`

  async function forwardPending() {
    const result = await mutation.mutate('post', balancePath)
    invalidateApiPath(balancePath)
    invalidateApiPath(invoicesPath)
    return result
  }

  return {
    forwardPending,
    forwardingPending: mutation.loading,
    forwardPendingError: mutation.error
  }
}

/** Manual recovery commands for one blocked deferred proxy settlement. */
export function useProxyForwardingMutations(
  username: string,
  invoiceId: string | null
) {
  const command = useMutation<
    ProxyForwardingCommand,
    ProxyForwardingCommandResult
  >()
  const invoicesPath = `/api/wallet/addresses/${encodeURIComponent(username)}/invoices`
  const commandPath = invoiceId
    ? `${invoicesPath}/${encodeURIComponent(invoiceId)}/forwarding`
    : null

  async function run(input: ProxyForwardingCommand) {
    if (!commandPath) throw new Error('No proxy payment selected')
    const result = await command.mutate('post', commandPath, input)
    invalidateApiPath(invoicesPath)
    return result
  }

  return {
    retryForwarding: () => run({ action: 'retry' }),
    changeDestination: (destination: string) =>
      run({ action: 'change_destination', destination }),
    recovering: command.loading,
    recoveryError: command.error
  }
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
  const probe = useMutation<{ address: string }, AliasProbeResponse>()
  const setPrimary = useMutation<
    undefined,
    { success: boolean; username: string }
  >()
  const remove = useMutation<
    undefined,
    { success: boolean; username: string }
  >()

  function invalidateAddressState(detailUsername?: string) {
    invalidateApiPath('/api/wallet/addresses')
    if (detailUsername) {
      invalidateApiPath(
        `/api/wallet/addresses/${encodeURIComponent(detailUsername)}`
      )
    }
    invalidateApiPath('/api/remote-wallets')
    invalidateApiPath('/api/users/me')
  }

  return {
    createAddress: async (input: CreateWalletAddressInput) => {
      const created = await create.mutate(
        'post',
        '/api/wallet/addresses',
        input
      )
      invalidateAddressState(created.username)
      return created
    },
    updateAddress: async (
      username: string,
      input: UpdateWalletAddressInput
    ) => {
      const updated = await update.mutate(
        'put',
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        input
      )
      invalidateAddressState(username)
      return updated
    },
    probeAliasAddress: (address: string) =>
      probe.mutate('post', '/api/wallet/addresses/alias-probe', { address }),
    setAsPrimary: async (username: string) => {
      const result = await setPrimary.mutate(
        'post',
        `/api/wallet/addresses/${encodeURIComponent(username)}/primary`,
        undefined
      )
      invalidateAddressState(username)
      return result
    },
    deleteAddress: async (username: string) => {
      const result = await remove.mutate(
        'del',
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        undefined
      )
      invalidateAddressState(username)
      return result
    },
    creating: create.loading,
    updating: update.loading,
    probingAlias: probe.loading,
    settingPrimary: setPrimary.loading,
    deleting: remove.loading,
    error:
      create.error ??
      update.error ??
      probe.error ??
      setPrimary.error ??
      remove.error
  }
}
