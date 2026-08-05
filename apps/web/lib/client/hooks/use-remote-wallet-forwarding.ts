'use client'

import {
  invalidateApiPath,
  useApi,
  useMutation
} from '@/lib/client/hooks/use-api'

export type ForwardReceiptStatus =
  | 'RECEIVED'
  | 'FORWARDING'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'RETAINED'

export interface ReceiveActionDestination {
  address: string
  allocationBps: number
}

export interface RemoteWalletForwardingMapAction {
  walletId: string
  enabled: boolean
  destinations: ReceiveActionDestination[]
}

/** Small graph-only projection; avoids loading receipts and attempts. */
export function useRemoteWalletForwardingMap() {
  return useApi<{ actions: RemoteWalletForwardingMapAction[] }>(
    '/api/remote-wallets/forwarding-map'
  )
}

export interface RemoteWalletReceiveActionData {
  walletId: string
  eligible: boolean
  reason: string | null
  configured: boolean
  enabled: boolean
  enabledAt: string | null
  pausedAt: string | null
  pendingReceipts: number
  pendingAmountMsats: number
  routingReserveBps: number
  routingReserveBaseSats: number
  revision: {
    number: number
    feeBps: number
    baseFeeSats: number
    destinations: ReceiveActionDestination[]
  } | null
}

export interface ForwardAttemptData {
  id: string
  attemptNo: number
  bolt11: string
  paymentHash: string
  amountMsats: number
  requestId: string
  status: string
  preimage: string | null
  routingFeeMsats: number | null
  routingReserveMsats: number
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  createdAt: string
  resolvedAt: string | null
}

export interface ForwardLegData {
  id: string
  position: number
  destination: string
  allocationBps: number
  requestedAmountMsats: number
  forwardedAmountMsats: number | null
  routingFeeMsats: number | null
  routingReserveMsats: number
  unusedRoutingReserveMsats: number
  routingFeeOverageMsats: number
  destinationShortfallMsats: number
  status: string
  retryCount: number
  nextRetryAt: string
  lastError: string | null
  createdAt: string
  completedAt: string | null
  batchAnchorId: string | null
  attempts?: ForwardAttemptData[]
}

export interface ForwardReceiptData {
  id: string
  walletId: string
  eventKey: string
  sourcePaymentHash: string
  sourceInvoice: string | null
  grossAmountMsats: number
  retainedFeeMsats: number
  targetAmountMsats: number
  forwardedAmountMsats: number
  routingFeeMsats: number
  routingReserveMsats: number
  unusedRoutingReserveMsats: number
  routingFeeOverageMsats: number
  shortfallMsats: number
  configRevision: number
  status: ForwardReceiptStatus
  recovered: boolean
  sourceSettledAt: string
  lastError: string | null
  nextRetryAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
  revision?: {
    feeBps: number
    baseFeeSats: number
    destinations: ReceiveActionDestination[]
  }
  legs: ForwardLegData[]
}

export interface ForwardActivityData {
  id: string
  receiptId: string
  legId: string
  destination: string
  attemptNo: number
  amountMsats: number
  status: string
  errorMessage: string | null
  createdAt: string
}

export interface RemoteWalletZapData {
  request: unknown
  requestJson: string
  receipt: unknown | null
  receiptJson: string | null
  receiptEventId: string | null
  receiptPublishedAt: string | null
  error: string | null
  nextRetryAt: string | null
}

export function useRemoteWalletReceiveAction(walletId: string | null) {
  return useApi<RemoteWalletReceiveActionData>(
    walletId ? `/api/remote-wallets/${walletId}/receive-action` : null
  )
}

export function useRemoteWalletForwardReceipts(
  walletId: string | null,
  options: {
    status?: ForwardReceiptStatus
    cursor?: string | null
    limit?: number
  } = {}
) {
  const query = new URLSearchParams()
  if (options.status) query.set('status', options.status)
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.limit) query.set('limit', String(options.limit))
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return useApi<{ receipts: ForwardReceiptData[]; nextCursor: string | null }>(
    walletId
      ? `/api/remote-wallets/${walletId}/forwarding-receipts${suffix}`
      : null
  )
}

export function useRemoteWalletForwardActivity(
  walletId: string | null,
  options: { cursor?: string | null; limit?: number } = {}
) {
  const query = new URLSearchParams()
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.limit) query.set('limit', String(options.limit))
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return useApi<{ activity: ForwardActivityData[]; nextCursor: string | null }>(
    walletId
      ? `/api/remote-wallets/${walletId}/forwarding-activity${suffix}`
      : null
  )
}

export function useRemoteWalletForwardReceipt(
  walletId: string | null,
  receiptId: string | null
) {
  return useApi<ForwardReceiptData>(
    walletId && receiptId
      ? `/api/remote-wallets/${walletId}/forwarding-receipts/${receiptId}`
      : null
  )
}

export function useRemoteWalletPayment(
  walletId: string | null,
  paymentHash: string | null
) {
  return useApi<{ zap: RemoteWalletZapData | null }>(
    walletId && paymentHash
      ? `/api/remote-wallets/${walletId}/payments/${paymentHash}`
      : null
  )
}

export function useRemoteWalletForwardingMutations(walletId: string) {
  const configure = useMutation<
    {
      feeBps: number
      baseFeeSats: number
      enabled?: boolean
      destinations: ReceiveActionDestination[]
    },
    RemoteWalletReceiveActionData
  >()
  const toggle = useMutation<
    { enabled: boolean },
    RemoteWalletReceiveActionData
  >()
  const retry = useMutation<
    { legIds?: string[] },
    { accepted: boolean; retryingLegs: number }
  >()
  const force = useMutation<
    Record<string, never>,
    { accepted: boolean; forwardingReceipts: number }
  >()
  const actionPath = `/api/remote-wallets/${walletId}/receive-action`
  const receiptsPath = `/api/remote-wallets/${walletId}/forwarding-receipts`
  const activityPath = `/api/remote-wallets/${walletId}/forwarding-activity`

  return {
    configure: async (input: {
      feeBps: number
      baseFeeSats: number
      enabled?: boolean
      destinations: ReceiveActionDestination[]
    }) => {
      const result = await configure.mutate('put', actionPath, input)
      invalidateApiPath(actionPath)
      invalidateApiPath('/api/remote-wallets/forwarding-map')
      invalidateApiPath(receiptsPath)
      invalidateApiPath(activityPath)
      return result
    },
    setEnabled: async (enabled: boolean) => {
      const result = await toggle.mutate('patch', actionPath, { enabled })
      invalidateApiPath(actionPath)
      invalidateApiPath('/api/remote-wallets/forwarding-map')
      invalidateApiPath(receiptsPath)
      invalidateApiPath(activityPath)
      return result
    },
    retryReceipt: async (receiptId: string, legIds?: string[]) => {
      const result = await retry.mutate(
        'post',
        `${receiptsPath}/${receiptId}/retry`,
        legIds ? { legIds } : {}
      )
      invalidateApiPath(actionPath)
      invalidateApiPath(receiptsPath)
      invalidateApiPath(activityPath)
      return result
    },
    forceForward: async () => {
      const result = await force.mutate('post', `${actionPath}/force`, {})
      invalidateApiPath(actionPath)
      invalidateApiPath(receiptsPath)
      invalidateApiPath(activityPath)
      return result
    },
    forcing: force.loading,
    loading:
      configure.loading || toggle.loading || retry.loading || force.loading,
    error: configure.error || toggle.error || retry.error || force.error
  }
}
