import type { Prisma } from '@/lib/generated/prisma'
import { eventBus } from '@/lib/events/event-bus'
import { normalizeNostrPubkey } from '@/lib/nostr/profile'
import { prisma } from '@/lib/prisma'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallet-forwarding/service'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export type NotificationAction = 'RECEIVED' | 'FORWARDED'

type NotificationWithDeliveries =
  Prisma.RemoteWalletNotificationGetPayload<{
    include: {
      deliveries: { include: { attempts: true } }
    }
  }>

type DeliveryWithAttempts =
  Prisma.RemoteWalletNotificationDeliveryGetPayload<{
    include: { attempts: true }
  }> & {
    notification?: {
      id: string
      name: string
      channel: 'WEBHOOK' | 'NOSTR'
      enabled: boolean
    } | null
  }

export type CreateNotificationInput =
  | {
      name: string
      channel: 'WEBHOOK'
      action: NotificationAction
      webhookUrl: string
    }
  | {
      name: string
      channel: 'NOSTR'
      action: NotificationAction
      kind: number
      pTag: string
      relays: string[]
      content: string
      nip44: boolean
    }

export async function listRemoteWalletNotifications(
  walletId: string,
  userId: string
) {
  await loadOwnedRemoteWallet(walletId, userId)
  const notifications = await prisma.remoteWalletNotification.findMany({
    where: { remoteWalletId: walletId },
    include: {
      deliveries: {
        include: { attempts: { orderBy: { attemptNo: 'desc' }, take: 5 } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5
      }
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  return {
    notifications: notifications.map(notificationDto)
  }
}

export async function createRemoteWalletNotification(
  walletId: string,
  userId: string,
  input: CreateNotificationInput
) {
  const wallet = await loadOwnedRemoteWallet(walletId, userId)
  if (wallet.status !== 'ACTIVE') {
    throw new ValidationError('Wallet must be active')
  }

  let channelData:
    | {
        webhookUrl: string
      }
    | {
        nostrKind: number
        nostrRecipient: string
        nostrRelays: Prisma.InputJsonValue
        nostrContent: string
        nip44: boolean
      }
  if (input.channel === 'WEBHOOK') {
    channelData = { webhookUrl: input.webhookUrl }
  } else {
    const recipient = normalizeNostrPubkey(input.pTag)
    if (!recipient) {
      throw new ValidationError('Nostr p tag must be a hex pubkey or npub')
    }
    channelData = {
      nostrKind: input.kind,
      nostrRecipient: recipient.pubkey,
      nostrRelays: [...new Set(input.relays)] as Prisma.InputJsonValue,
      nostrContent: input.content,
      nip44: input.nip44
    }
  }

  await prisma.remoteWalletNotification.create({
    data: {
      remoteWalletId: walletId,
      name: input.name,
      channel: input.channel,
      action: input.action,
      enabled: true,
      ...channelData
    }
  })
  emitNotificationsUpdated()
  return listRemoteWalletNotifications(walletId, userId)
}

export async function setRemoteWalletNotificationEnabled(
  walletId: string,
  notificationId: string,
  userId: string,
  enabled: boolean
) {
  await loadOwnedRemoteWallet(walletId, userId)
  const result = await prisma.remoteWalletNotification.updateMany({
    where: { id: notificationId, remoteWalletId: walletId },
    data: { enabled, pausedAt: enabled ? null : new Date() }
  })
  if (result.count === 0) throw new NotFoundError('Notification not found')
  emitNotificationsUpdated()
  return listRemoteWalletNotifications(walletId, userId)
}

export async function listRemoteWalletNotificationDeliveries(
  walletId: string,
  userId: string,
  options: { cursor?: string; limit: number }
) {
  await loadOwnedRemoteWallet(walletId, userId)
  const rows = await prisma.remoteWalletNotificationDelivery.findMany({
    where: { walletId },
    include: {
      notification: {
        select: { id: true, name: true, channel: true, enabled: true }
      },
      attempts: { orderBy: { attemptNo: 'desc' } }
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  })
  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  return {
    deliveries: page.map(deliveryDto),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null
  }
}

export async function retryRemoteWalletNotificationDelivery(
  walletId: string,
  deliveryId: string,
  userId: string
) {
  await loadOwnedRemoteWallet(walletId, userId)
  const delivery = await prisma.remoteWalletNotificationDelivery.findFirst({
    where: { id: deliveryId, walletId },
    include: {
      notification: { select: { channel: true, enabled: true } },
      attempts: { orderBy: { attemptNo: 'desc' }, take: 1 }
    }
  })
  if (!delivery) throw new NotFoundError('Notification delivery not found')
  if (!delivery.notification.enabled) {
    throw new ConflictError('Resume this notification before retrying')
  }
  if (delivery.status === 'SUCCEEDED') {
    throw new ConflictError('This notification was already delivered')
  }
  if (
    delivery.status === 'PENDING' &&
    delivery.leaseExpiresAt &&
    delivery.leaseExpiresAt > new Date()
  ) {
    throw new ConflictError('This notification is already being delivered')
  }
  const latest = delivery.attempts[0]
  if (
    delivery.notification.channel === 'WEBHOOK' &&
    (delivery.status === 'UNKNOWN' || latest?.status === 'UNKNOWN')
  ) {
    throw new ConflictError(
      'Webhook outcome is unknown; retrying could send the event twice'
    )
  }
  await prisma.remoteWalletNotificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: 'REJECTED',
      nextRetryAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null
    }
  })
  emitNotificationsUpdated()
  return { accepted: true }
}

export async function enqueueRemoteWalletNotificationEvent(input: {
  walletId: string
  action: NotificationAction
  eventKey: string
  payload: unknown
}): Promise<string[]> {
  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: input.walletId },
    select: { id: true, userId: true, status: true, name: true }
  })
  if (!wallet || wallet.status !== 'ACTIVE') return []
  const notifications = await prisma.remoteWalletNotification.findMany({
    where: {
      remoteWalletId: input.walletId,
      action: input.action,
      enabled: true
    },
    select: { id: true }
  })
  if (notifications.length === 0) return []
  const payload = toJsonValue({
    version: 1,
    action: input.action,
    wallet: { id: wallet.id, name: wallet.name, userId: wallet.userId },
    eventKey: input.eventKey,
    data: input.payload
  })
  await prisma.remoteWalletNotificationDelivery.createMany({
    data: notifications.map(notification => ({
      notificationId: notification.id,
      walletId: wallet.id,
      userId: wallet.userId,
      eventKey: input.eventKey,
      action: input.action,
      payload
    })),
    skipDuplicates: true
  })
  const deliveries = await prisma.remoteWalletNotificationDelivery.findMany({
    where: {
      notificationId: { in: notifications.map(item => item.id) },
      eventKey: input.eventKey,
      status: { in: ['READY', 'REJECTED'] }
    },
    select: { id: true }
  })
  if (deliveries.length > 0) emitNotificationsUpdated()
  return deliveries.map(delivery => delivery.id)
}

export async function enqueueForwardedReceiptNotifications(
  receiptId: string
): Promise<string[]> {
  const receipt = await prisma.remoteWalletForwardReceipt.findUnique({
    where: { id: receiptId },
    include: {
      revision: {
        include: { destinations: { orderBy: { position: 'asc' } } }
      },
      legs: {
        include: { attempts: { orderBy: { attemptNo: 'asc' } } },
        orderBy: { position: 'asc' }
      }
    }
  })
  if (!receipt || receipt.status !== 'COMPLETED') return []
  return enqueueRemoteWalletNotificationEvent({
    walletId: receipt.walletId,
    action: 'FORWARDED',
    eventKey: `forwarded:${receipt.id}`,
    payload: receipt
  })
}

export function emitNotificationsUpdated(): void {
  eventBus.emit({
    type: 'remote-wallet-notifications:updated',
    timestamp: Date.now()
  })
}

function notificationDto(notification: NotificationWithDeliveries) {
  return {
    id: notification.id,
    name: notification.name,
    channel: notification.channel,
    action: notification.action,
    enabled: notification.enabled,
    pausedAt: notification.pausedAt?.toISOString() ?? null,
    webhookUrl: notification.webhookUrl,
    nostrKind: notification.nostrKind,
    nostrRecipient: notification.nostrRecipient,
    nostrRelays: Array.isArray(notification.nostrRelays)
      ? notification.nostrRelays
      : [],
    nostrContent: notification.nostrContent,
    nip44: notification.nip44,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    deliveries: notification.deliveries.map(deliveryDto)
  }
}

function deliveryDto(delivery: DeliveryWithAttempts) {
  return {
    id: delivery.id,
    notificationId: delivery.notificationId,
    notification: delivery.notification ?? null,
    eventKey: delivery.eventKey,
    action: delivery.action,
    payload: delivery.payload,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    lastError: delivery.lastError,
    nextRetryAt: delivery.nextRetryAt.toISOString(),
    completedAt: delivery.completedAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
    attempts: delivery.attempts.map(attempt => ({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      requestId: attempt.requestId,
      status: attempt.status,
      responseStatus: attempt.responseStatus,
      responseBody: attempt.responseBody,
      nostrEventId: attempt.nostrEventId,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      createdAt: attempt.createdAt.toISOString(),
      resolvedAt: attempt.resolvedAt?.toISOString() ?? null
    }))
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, candidate) =>
      typeof candidate === 'bigint' ? candidate.toString() : candidate
    )
  ) as Prisma.InputJsonValue
}
