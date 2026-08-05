import { createHash, randomUUID } from 'node:crypto'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { publishNotificationNostrEvent } from './nostr'
import { emitNotificationsUpdated } from './service'
import { postNotificationWebhook } from './webhook'

const LEASE_MS = 5 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 8
const BATCH_SIZE = 20

export async function reconcileRemoteWalletNotifications(
  options: { ids?: string[]; workerId?: string; limit?: number } = {}
): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const workerId = options.workerId ?? randomUUID()
  const ids = await claimDeliveries(
    workerId,
    options.ids,
    Math.min(BATCH_SIZE, Math.max(1, options.limit ?? BATCH_SIZE))
  )
  let succeeded = 0
  let failed = 0
  for (const id of ids) {
    try {
      if (await deliverOne(id, workerId)) succeeded++
      else failed++
    } catch (error) {
      failed++
      logger.error(
        { err: error, remoteWalletNotificationDeliveryId: id },
        'remote_wallet_notification.delivery_failed'
      )
      await releaseRejected(id, workerId, errorMessage(error))
    } finally {
      emitNotificationsUpdated()
    }
  }
  return { claimed: ids.length, succeeded, failed }
}

async function claimDeliveries(
  workerId: string,
  requestedIds: string[] | undefined,
  limit: number
): Promise<string[]> {
  const normalizedIds = [
    ...new Set((requestedIds ?? []).filter(id => id.length > 0))
  ].slice(0, BATCH_SIZE)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidates AS (
      SELECT delivery."id"
        FROM "RemoteWalletNotificationDelivery" delivery
        JOIN "RemoteWalletNotification" notification
          ON notification."id" = delivery."notificationId"
        JOIN "RemoteWallet" wallet ON wallet."id" = delivery."walletId"
       WHERE notification."enabled" = true
         AND wallet."status" = 'ACTIVE'::"RemoteWalletStatus"
         AND delivery."status" IN (
           'READY'::"RemoteWalletNotificationDeliveryStatus",
           'REJECTED'::"RemoteWalletNotificationDeliveryStatus",
           'PENDING'::"RemoteWalletNotificationDeliveryStatus"
         )
         AND delivery."nextRetryAt" <= CURRENT_TIMESTAMP
         AND (
           delivery."leaseExpiresAt" IS NULL
           OR delivery."leaseExpiresAt" < CURRENT_TIMESTAMP
         )
         AND (
           cardinality(${normalizedIds}::text[]) = 0
           OR delivery."id" = ANY(${normalizedIds}::text[])
         )
       ORDER BY delivery."nextRetryAt", delivery."createdAt"
       FOR UPDATE OF delivery SKIP LOCKED
       LIMIT ${limit}
    )
    UPDATE "RemoteWalletNotificationDelivery" delivery
       SET "status" = 'PENDING'::"RemoteWalletNotificationDeliveryStatus",
           "leaseOwner" = ${workerId},
           "leaseExpiresAt" = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond'),
           "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
     WHERE delivery."id" = candidates."id"
    RETURNING delivery."id"
  `
  return rows.map(row => row.id)
}

async function deliverOne(id: string, workerId: string): Promise<boolean> {
  const delivery = await prisma.remoteWalletNotificationDelivery.findUnique({
    where: { id },
    include: {
      notification: true,
      attempts: { orderBy: { attemptNo: 'desc' }, take: 1 }
    }
  })
  if (
    !delivery ||
    delivery.leaseOwner !== workerId ||
    !delivery.notification.enabled
  ) {
    return false
  }

  const previous = delivery.attempts[0]
  if (previous?.status === 'PENDING') {
    await prisma.$transaction([
      prisma.remoteWalletNotificationAttempt.update({
        where: { id: previous.id },
        data: {
          status: 'UNKNOWN',
          errorCode: 'worker_interrupted',
          errorMessage: 'Worker stopped after starting the outbound request',
          resolvedAt: new Date()
        }
      }),
      prisma.remoteWalletNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'UNKNOWN',
          lastError:
            'Previous delivery outcome is unknown; automatic retry was stopped to prevent duplicates',
          leaseOwner: null,
          leaseExpiresAt: null
        }
      })
    ])
    return false
  }
  if (delivery.attemptCount >= MAX_ATTEMPTS) {
    await prisma.remoteWalletNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'EXPIRED',
        lastError: `Delivery stopped after ${MAX_ATTEMPTS} attempts`,
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
    return false
  }

  const attemptNo = delivery.attemptCount + 1
  const requestId = createHash('sha256')
    .update(`remote-wallet-notification:${delivery.id}:${attemptNo}`)
    .digest('hex')
  const attempt = await prisma.$transaction(async tx => {
    const current = await tx.remoteWalletNotificationDelivery.findFirst({
      where: { id: delivery.id, leaseOwner: workerId },
      select: { id: true, attemptCount: true }
    })
    if (!current || current.attemptCount !== delivery.attemptCount) return null
    const created = await tx.remoteWalletNotificationAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNo,
        requestId
      }
    })
    await tx.remoteWalletNotificationDelivery.update({
      where: { id: delivery.id },
      data: { attemptCount: { increment: 1 }, lastError: null }
    })
    return created
  })
  if (!attempt) return false

  try {
    if (delivery.notification.channel === 'WEBHOOK') {
      const response = await postNotificationWebhook({
        url: delivery.notification.webhookUrl!,
        requestId,
        eventKey: delivery.eventKey,
        body: JSON.stringify(delivery.payload)
      })
      if (response.status < 200 || response.status >= 300) {
        await rejectAttempt(
          delivery.id,
          attempt.id,
          workerId,
          `Webhook returned HTTP ${response.status}`,
          response.status,
          response.body
        )
        return false
      }
      await succeedAttempt(
        delivery.id,
        attempt.id,
        workerId,
        response.status,
        response.body,
        null
      )
      return true
    }

    const relays = Array.isArray(delivery.notification.nostrRelays)
      ? delivery.notification.nostrRelays.filter(
          (relay): relay is string => typeof relay === 'string'
        )
      : []
    const published = await publishNotificationNostrEvent({
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      kind: delivery.notification.nostrKind!,
      recipient: delivery.notification.nostrRecipient!,
      relays,
      contentTemplate: delivery.notification.nostrContent ?? '{{payload}}',
      encrypt: delivery.notification.nip44,
      payload: delivery.payload
    })
    await succeedAttempt(
      delivery.id,
      attempt.id,
      workerId,
      null,
      null,
      published.eventId
    )
    return true
  } catch (error) {
    const message = errorMessage(error)
    if (
      delivery.notification.channel === 'WEBHOOK' &&
      !isSafePreflightFailure(message)
    ) {
      await markUnknown(delivery.id, attempt.id, workerId, message)
      return false
    }
    // Nostr retries republish the exact same signed event id, so relay errors
    // are safely retryable. Webhook validation/DNS rejection happens before
    // bytes are sent and is retryable as well.
    await rejectAttempt(delivery.id, attempt.id, workerId, message, null, null)
    return false
  }
}

async function succeedAttempt(
  deliveryId: string,
  attemptId: string,
  workerId: string,
  responseStatus: number | null,
  responseBody: string | null,
  nostrEventId: string | null
) {
  const now = new Date()
  await prisma.$transaction([
    prisma.remoteWalletNotificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'SUCCEEDED',
        responseStatus,
        responseBody: responseBody?.slice(0, 32_768) ?? null,
        nostrEventId,
        resolvedAt: now
      }
    }),
    prisma.remoteWalletNotificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: workerId },
      data: {
        status: 'SUCCEEDED',
        completedAt: now,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
  ])
}

async function rejectAttempt(
  deliveryId: string,
  attemptId: string,
  workerId: string,
  message: string,
  responseStatus: number | null,
  responseBody: string | null
) {
  const now = new Date()
  await prisma.$transaction([
    prisma.remoteWalletNotificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'REJECTED',
        responseStatus,
        responseBody: responseBody?.slice(0, 32_768) ?? null,
        errorCode: responseStatus
          ? `http_${responseStatus}`
          : 'delivery_failed',
        errorMessage: message,
        resolvedAt: now
      }
    }),
    prisma.remoteWalletNotificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: workerId },
      data: {
        status: 'REJECTED',
        lastError: message,
        nextRetryAt: new Date(now.getTime() + RETRY_MS),
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
  ])
}

async function markUnknown(
  deliveryId: string,
  attemptId: string,
  workerId: string,
  message: string
) {
  const now = new Date()
  await prisma.$transaction([
    prisma.remoteWalletNotificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'UNKNOWN',
        errorCode: 'transport_unknown',
        errorMessage: message,
        resolvedAt: now
      }
    }),
    prisma.remoteWalletNotificationDelivery.updateMany({
      where: { id: deliveryId, leaseOwner: workerId },
      data: {
        status: 'UNKNOWN',
        lastError:
          'Webhook transport ended ambiguously; retry stopped to prevent duplicate delivery',
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
  ])
}

async function releaseRejected(
  deliveryId: string,
  workerId: string,
  message: string
) {
  await prisma.remoteWalletNotificationDelivery.updateMany({
    where: { id: deliveryId, leaseOwner: workerId },
    data: {
      status: 'REJECTED',
      lastError: message,
      nextRetryAt: new Date(Date.now() + RETRY_MS),
      leaseOwner: null,
      leaseExpiresAt: null
    }
  })
}

function isSafePreflightFailure(message: string): boolean {
  return /(must use HTTPS|must not contain credentials|resolves to a private network|getaddrinfo ENOTFOUND)/i.test(
    message
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
