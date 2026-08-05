'use client'

import { useApi, useMutation, withQuery } from '@/lib/client/hooks/use-api'

export type RemoteWalletNotificationAction = 'RECEIVED' | 'FORWARDED'
export type RemoteWalletNotificationChannel = 'WEBHOOK' | 'NOSTR'
export type RemoteWalletNotificationDeliveryStatus =
  | 'READY'
  | 'PENDING'
  | 'UNKNOWN'
  | 'REJECTED'
  | 'SUCCEEDED'
  | 'EXPIRED'

export interface RemoteWalletNotificationAttemptData {
  id: string
  attemptNo: number
  requestId: string
  status: string
  responseStatus: number | null
  responseBody: string | null
  nostrEventId: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface RemoteWalletNotificationDeliveryData {
  id: string
  notificationId: string
  notification?: {
    id: string
    name: string
    channel: RemoteWalletNotificationChannel
    enabled: boolean
  } | null
  eventKey: string
  action: RemoteWalletNotificationAction
  payload: unknown
  status: RemoteWalletNotificationDeliveryStatus
  attemptCount: number
  lastError: string | null
  nextRetryAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
  attempts: RemoteWalletNotificationAttemptData[]
}

export interface RemoteWalletNotificationData {
  id: string
  name: string
  channel: RemoteWalletNotificationChannel
  action: RemoteWalletNotificationAction
  enabled: boolean
  pausedAt: string | null
  webhookUrl: string | null
  nostrKind: number | null
  nostrRecipient: string | null
  nostrRelays: string[]
  nostrContent: string | null
  nip44: boolean
  createdAt: string
  updatedAt: string
  deliveries: RemoteWalletNotificationDeliveryData[]
}

export type CreateRemoteWalletNotificationInput =
  | {
      name: string
      channel: 'WEBHOOK'
      action: RemoteWalletNotificationAction
      webhookUrl: string
    }
  | {
      name: string
      channel: 'NOSTR'
      action: RemoteWalletNotificationAction
      kind: number
      pTag: string
      relays: string[]
      content: string
      nip44: boolean
    }

export function useRemoteWalletNotifications(walletId: string | null) {
  return useApi<{ notifications: RemoteWalletNotificationData[] }>(
    walletId ? `/api/remote-wallets/${walletId}/notifications` : null
  )
}

export function useRemoteWalletNotificationDeliveries(
  walletId: string | null,
  options: { cursor?: string | null; limit?: number } = {}
) {
  return useApi<{
    deliveries: RemoteWalletNotificationDeliveryData[]
    nextCursor: string | null
  }>(
    walletId
      ? withQuery(`/api/remote-wallets/${walletId}/notification-deliveries`, {
          cursor: options.cursor ?? undefined,
          limit: options.limit
        })
      : null
  )
}

export function useRemoteWalletNotificationMutations(walletId: string) {
  const notificationsPath = `/api/remote-wallets/${walletId}/notifications`
  const deliveriesPath = `/api/remote-wallets/${walletId}/notification-deliveries`
  const paths = [notificationsPath, deliveriesPath]

  const create = useMutation<
    CreateRemoteWalletNotificationInput,
    { notifications: RemoteWalletNotificationData[] }
  >(paths)
  const toggle = useMutation<
    { enabled: boolean },
    { notifications: RemoteWalletNotificationData[] }
  >(paths)
  const retry = useMutation<Record<string, never>, { accepted: boolean }>(paths)

  return {
    create: (input: CreateRemoteWalletNotificationInput) =>
      create.mutate('post', notificationsPath, input),
    setEnabled: (notificationId: string, enabled: boolean) =>
      toggle.mutate('patch', `${notificationsPath}/${notificationId}`, {
        enabled
      }),
    retry: (deliveryId: string) =>
      retry.mutate('post', `${deliveriesPath}/${deliveryId}/retry`, {}),
    loading: create.loading || toggle.loading || retry.loading,
    error: create.error ?? toggle.error ?? retry.error
  }
}
