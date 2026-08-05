import { createHash, randomUUID } from 'node:crypto'
import type {
  RemoteWalletForwardAttempt,
  RemoteWalletForwardLeg,
  RemoteWalletForwardReceipt
} from '@/lib/generated/prisma'
import { preimageMatchesPaymentHash } from '@/lib/card-payments/lifecycle'
import { getListenerConfig } from '@/lib/listener-config'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  fetchDestinationMetadata,
  requestDestinationInvoice
} from '@/lib/proxy/lnurl'
import { isDestinationInvoiceAmountAcceptable } from '@/lib/proxy/money'
import { resolveApiUrl, resolvePublicEndpoint } from '@/lib/public-url'
import {
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest,
  ListenerPaymentAmbiguousError
} from '@/lib/wallet/drivers/listener-transport'
import { decryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'
import {
  allocateForwardingAmounts,
  calculateForwardingAmounts,
  calculateRoutingReserve,
  FORWARDING_AMOUNT_TOO_SMALL_ERROR
} from './money'
import { emitForwardingUpdated } from './service'
import { enqueueForwardedReceiptNotifications } from '@/lib/remote-wallet-notifications/service'
import { reconcileRemoteWalletNotifications } from '@/lib/remote-wallet-notifications/reconcile'

const LEASE_MS = 5 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000
const BATCH_SIZE = 10

type ReceiptWithRelations = RemoteWalletForwardReceipt & {
  action: { id: string; enabled: boolean }
  revision: {
    feeBps: number
    baseFeeMsats: bigint
    destinations: Array<{
      address: string
      allocationBps: number
      position: number
    }>
  }
  wallet: {
    id: string
    type: 'NWC' | 'LND' | 'CLN' | 'BTCPAY'
    config: unknown
    status: string
  }
  legs: Array<
    RemoteWalletForwardLeg & { attempts: RemoteWalletForwardAttempt[] }
  >
}

export async function reconcileRemoteWalletForwarding(
  options: {
    ids?: string[]
    walletIds?: string[]
    workerId?: string
    limit?: number
  } = {}
): Promise<{ claimed: number; completed: number; failed: number }> {
  const workerId = options.workerId ?? randomUUID()
  const ids = await claimReceipts(
    workerId,
    options.ids,
    options.walletIds,
    Math.min(BATCH_SIZE, Math.max(1, options.limit ?? BATCH_SIZE))
  )
  let completed = 0
  let failed = 0
  for (const id of ids) {
    try {
      if (await reconcileOne(id, workerId)) completed++
    } catch (error) {
      failed++
      const message = errorMessage(error)
      logger.error(
        { err: error, remoteWalletForwardReceiptId: id },
        'remote_wallet_forwarding.reconcile_failed'
      )
      await prisma.remoteWalletForwardReceipt.updateMany({
        where: { id, leaseOwner: workerId },
        data: {
          status: 'BLOCKED',
          lastError: message,
          nextRetryAt: new Date(Date.now() + RETRY_MS),
          leaseOwner: null,
          leaseExpiresAt: null
        }
      })
    } finally {
      try {
        await releaseActionLease(id, workerId)
      } catch (error) {
        logger.warn(
          { err: error, remoteWalletForwardReceiptId: id, workerId },
          'remote_wallet_forwarding.action_lease_release_failed'
        )
      }
      emitForwardingUpdated()
    }
  }
  return { claimed: ids.length, completed, failed }
}

async function claimReceipts(
  workerId: string,
  requestedIds: string[] | undefined,
  requestedWalletIds: string[] | undefined,
  limit: number
): Promise<string[]> {
  const normalizedIds = [
    ...new Set((requestedIds ?? []).filter(id => id.length > 0))
  ].slice(0, BATCH_SIZE)
  const normalizedWalletIds = [
    ...new Set((requestedWalletIds ?? []).filter(id => id.length > 0))
  ].slice(0, BATCH_SIZE)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidate_actions AS (
      SELECT action."id"
        FROM "RemoteWalletReceiveAction" action
        JOIN "RemoteWallet" wallet ON wallet."id" = action."remoteWalletId"
       WHERE action."enabled" = true
         AND wallet."status" = 'ACTIVE'::"RemoteWalletStatus"
         AND (
           cardinality(${normalizedWalletIds}::text[]) = 0
           OR action."remoteWalletId" = ANY(${normalizedWalletIds}::text[])
         )
         AND (action."leaseExpiresAt" IS NULL OR action."leaseExpiresAt" < CURRENT_TIMESTAMP)
         AND EXISTS (
           SELECT 1
             FROM "RemoteWalletForwardReceipt" receipt
            WHERE receipt."actionId" = action."id"
              AND receipt."status" IN (
                'RECEIVED'::"RemoteWalletForwardReceiptStatus",
                'FORWARDING'::"RemoteWalletForwardReceiptStatus",
                'PARTIAL'::"RemoteWalletForwardReceiptStatus",
                'BLOCKED'::"RemoteWalletForwardReceiptStatus"
              )
              AND receipt."nextRetryAt" <= CURRENT_TIMESTAMP
              AND (receipt."leaseExpiresAt" IS NULL OR receipt."leaseExpiresAt" < CURRENT_TIMESTAMP)
              AND (
                cardinality(${normalizedIds}::text[]) = 0
                OR receipt."id" = ANY(${normalizedIds}::text[])
              )
         )
       ORDER BY action."id"
       FOR UPDATE OF action SKIP LOCKED
       LIMIT ${limit}
    ), claimed_actions AS (
      UPDATE "RemoteWalletReceiveAction" action
         SET "leaseOwner" = ${workerId},
             "leaseExpiresAt" = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond'),
             "updatedAt" = CURRENT_TIMESTAMP
        FROM candidate_actions
       WHERE action."id" = candidate_actions."id"
      RETURNING action."id"
    ), candidates AS (
      SELECT picked."id"
        FROM claimed_actions
        CROSS JOIN LATERAL (
          SELECT receipt."id"
            FROM "RemoteWalletForwardReceipt" receipt
           WHERE receipt."actionId" = claimed_actions."id"
             AND receipt."status" IN (
               'RECEIVED'::"RemoteWalletForwardReceiptStatus",
               'FORWARDING'::"RemoteWalletForwardReceiptStatus",
               'PARTIAL'::"RemoteWalletForwardReceiptStatus",
               'BLOCKED'::"RemoteWalletForwardReceiptStatus"
             )
             AND receipt."nextRetryAt" <= CURRENT_TIMESTAMP
             AND (receipt."leaseExpiresAt" IS NULL OR receipt."leaseExpiresAt" < CURRENT_TIMESTAMP)
             AND (
               cardinality(${normalizedIds}::text[]) = 0
               OR receipt."id" = ANY(${normalizedIds}::text[])
             )
           ORDER BY receipt."nextRetryAt", receipt."createdAt"
           FOR UPDATE OF receipt SKIP LOCKED
           LIMIT 1
        ) picked
    )
    UPDATE "RemoteWalletForwardReceipt" receipt
       SET "leaseOwner" = ${workerId},
           "leaseExpiresAt" = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond'),
           "status" = CASE
             WHEN receipt."status" = 'RECEIVED'::"RemoteWalletForwardReceiptStatus"
               THEN 'FORWARDING'::"RemoteWalletForwardReceiptStatus"
             ELSE receipt."status"
           END,
           "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
     WHERE receipt."id" = candidates."id"
    RETURNING receipt."id"
  `
  return rows.map(row => row.id)
}

async function reconcileOne(id: string, workerId: string): Promise<boolean> {
  let receipt = await loadReceipt(id)
  if (!receipt || receipt.leaseOwner !== workerId || !receipt.action.enabled) {
    return false
  }
  if (receipt.grossAmountMsats === BigInt(0)) {
    const recovered = await recoverMissingAmount(receipt, workerId)
    if (!recovered) {
      await release(receipt.id, workerId, 'BLOCKED', receipt.lastError)
      return false
    }
    receipt = (await loadReceipt(id))!
    if (receipt.status === 'RETAINED') {
      await prisma.remoteWalletForwardReceipt.updateMany({
        where: { id: receipt.id, leaseOwner: workerId },
        data: { leaseOwner: null, leaseExpiresAt: null }
      })
      return true
    }
  }

  await materializePendingLegs(receipt.actionId)
  receipt = (await loadReceipt(id))!

  for (const leg of receipt.legs.sort((a, b) => a.position - b.position)) {
    if (leg.status === 'SUCCEEDED' || leg.status === 'SUPERSEDED') continue
    const stillActive = await prisma.remoteWalletReceiveAction.findFirst({
      where: { id: receipt.actionId, enabled: true },
      select: { id: true }
    })
    if (!stillActive) {
      await release(
        receipt.id,
        workerId,
        receipt.status,
        'Forwarding is paused'
      )
      return false
    }
    await reconcileLeg(receipt, leg)
  }
  return finalizeReceipt(receipt.id, workerId, receipt.lastError)
}

async function loadReceipt(id: string): Promise<ReceiptWithRelations | null> {
  return prisma.remoteWalletForwardReceipt.findUnique({
    where: { id },
    include: {
      action: { select: { id: true, enabled: true } },
      revision: {
        select: {
          feeBps: true,
          baseFeeMsats: true,
          destinations: { orderBy: { position: 'asc' } }
        }
      },
      wallet: { select: { id: true, type: true, config: true, status: true } },
      legs: {
        include: { attempts: { orderBy: { attemptNo: 'desc' }, take: 1 } },
        orderBy: { position: 'asc' }
      }
    }
  }) as Promise<ReceiptWithRelations | null>
}

async function materializePendingLegs(actionId: string): Promise<void> {
  const receipts = await prisma.remoteWalletForwardReceipt.findMany({
    where: {
      actionId,
      targetAmountMsats: { gt: BigInt(0) },
      status: { in: ['RECEIVED', 'FORWARDING', 'PARTIAL', 'BLOCKED'] },
      legs: { none: {} }
    },
    include: {
      revision: {
        select: {
          destinations: { orderBy: { position: 'asc' } }
        }
      }
    }
  })

  for (const receipt of receipts) {
    const allocations = allocateForwardingAmounts(
      receipt.targetAmountMsats,
      receipt.revision.destinations.map(destination => ({
        address: destination.address,
        allocationBps: destination.allocationBps
      }))
    ).filter(allocation => allocation.amountMsats > BigInt(0))
    await prisma.$transaction(async tx => {
      const existing = await tx.remoteWalletForwardLeg.count({
        where: { receiptId: receipt.id }
      })
      if (existing > 0) return
      await tx.remoteWalletForwardLeg.createMany({
        data: allocations.map(allocation => ({
          receiptId: receipt.id,
          position: allocation.position,
          destination: allocation.address,
          allocationBps: allocation.allocationBps,
          requestedAmountMsats: allocation.amountMsats
        }))
      })
      await tx.remoteWalletForwardReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'RECEIVED',
          routingReserveMsats: BigInt(0),
          lastError: null,
          nextRetryAt: new Date()
        }
      })
    })
  }
}

async function recoverMissingAmount(
  receipt: ReceiptWithRelations,
  workerId: string
): Promise<boolean> {
  const config = walletConfig(receipt)
  const bridge = await getListenerConfig()
  let source
  try {
    source = await listenerNwcRequest<{ state?: string; amount?: number }>(
      bridge,
      {
        connectionString: config.connectionString,
        method: 'lookup_invoice',
        params: { payment_hash: receipt.sourcePaymentHash }
      }
    )
  } catch {
    return false
  }
  if (source.state !== 'settled' || !source.amount || source.amount <= 0)
    return false
  const gross = BigInt(source.amount)
  const amounts = calculateForwardingAmounts(
    gross,
    receipt.revision.feeBps,
    receipt.revision.baseFeeMsats
  )
  const destinations = receipt.revision.destinations.map(destination => ({
    address: destination.address,
    allocationBps: destination.allocationBps
  }))
  const allocations =
    amounts.targetAmountMsats > BigInt(0)
      ? allocateForwardingAmounts(amounts.targetAmountMsats, destinations)
      : []
  await prisma.$transaction(async tx => {
    const updated = await tx.remoteWalletForwardReceipt.updateMany({
      where: {
        id: receipt.id,
        leaseOwner: workerId,
        grossAmountMsats: BigInt(0)
      },
      data: {
        grossAmountMsats: gross,
        retainedFeeMsats: amounts.retainedFeeMsats,
        targetAmountMsats: amounts.targetAmountMsats,
        routingReserveMsats: BigInt(0),
        status:
          amounts.targetAmountMsats === BigInt(0) ? 'RETAINED' : 'FORWARDING',
        lastError: null,
        completedAt: amounts.targetAmountMsats === BigInt(0) ? new Date() : null
      }
    })
    if (updated.count === 0 || amounts.targetAmountMsats === BigInt(0)) return
    await tx.remoteWalletForwardLeg.createMany({
      data: allocations
        .filter(allocation => allocation.amountMsats > BigInt(0))
        .map(allocation => ({
          receiptId: receipt.id,
          position: allocation.position,
          destination: allocation.address,
          allocationBps: allocation.allocationBps,
          requestedAmountMsats: allocation.amountMsats,
          routingReserveMsats: BigInt(0)
        }))
    })
  })
  return true
}

async function reconcileLeg(
  receipt: ReceiptWithRelations,
  leg: RemoteWalletForwardLeg & { attempts: RemoteWalletForwardAttempt[] }
): Promise<void> {
  let batch = await loadForwardingBatch(receipt, leg, false)
  let latest = batch.latest
  let lastAttemptNo = latest?.attemptNo ?? 0
  if (latest?.status === 'SUCCEEDED') {
    await completeBatch(receipt.id, batch.anchorId, latest)
    return
  }
  if (latest && (latest.status === 'PENDING' || latest.status === 'UNKNOWN')) {
    const outcome = await reconcileAttempt(receipt, latest)
    if (outcome === 'SUCCEEDED') {
      const settled = await prisma.remoteWalletForwardAttempt.findUniqueOrThrow(
        {
          where: { id: latest.id }
        }
      )
      await completeBatch(receipt.id, batch.anchorId, settled)
      return
    }
    if (outcome === 'WAIT') {
      await setBatchLegState(
        batch.anchorId,
        'UNKNOWN',
        latest.errorMessage ?? 'Forwarding outcome is still unknown'
      )
      return
    }
    await setBatchLegState(
      batch.anchorId,
      'REJECTED',
      latest.errorMessage ?? 'Forwarding attempt was rejected',
      true
    )
    latest = await prisma.remoteWalletForwardAttempt.findUnique({
      where: { id: latest.id }
    })
    lastAttemptNo = Math.max(lastAttemptNo, latest?.attemptNo ?? 0)
  }
  if (latest && latest.expiresAt <= new Date()) {
    await prisma.remoteWalletForwardAttempt.updateMany({
      where: {
        id: latest.id,
        status: { in: ['PENDING', 'UNKNOWN', 'REJECTED'] }
      },
      data: {
        status: 'EXPIRED',
        resolvedAt: new Date(),
        errorCode: 'invoice_expired'
      }
    })
    await setBatchLegState(
      batch.anchorId,
      'EXPIRED',
      'Destination invoice expired'
    )
    latest = null
  }

  latest = await hydrateRejectedWalletError(latest)
  batch = await loadForwardingBatch(receipt, leg, true)

  const insufficientBalance = isInsufficientBalance(latest)
  const requestedAmountMsats = batch.members.reduce(
    (sum, member) => sum + member.requestedAmountMsats,
    BigInt(0)
  )
  let routingReserveMsats = nextRoutingReserve(
    requestedAmountMsats,
    insufficientBalance ? latest : null
  )
  const invoiceAmountMsats = requestedAmountMsats - routingReserveMsats
  if (invoiceAmountMsats <= BigInt(0)) {
    await blockUntilMorePendingFunds(batch.members.map(member => member.id))
    return
  }

  let invoice =
    latest &&
    !insufficientBalance &&
    latest.expiresAt > new Date() &&
    latest.amountMsats === invoiceAmountMsats
      ? {
          bolt11: latest.bolt11,
          paymentHash: latest.paymentHash,
          amountMsats: Number(latest.amountMsats),
          expiresAt: latest.expiresAt
        }
      : null
  if (!invoice) {
    const blockedHosts = await localBlockedHosts()
    const metadata = await fetchDestinationMetadata(leg.destination, {
      blockedHosts
    })
    const requested = Number(invoiceAmountMsats)
    if (requested < metadata.minSendable) {
      await blockUntilMorePendingFunds(batch.members.map(member => member.id))
      return
    }
    if (requested > metadata.maxSendable) {
      await rejectPendingBatch(
        batch.members.map(member => member.id),
        'The full pending amount exceeds the destination maximum'
      )
      return
    }
    invoice = await requestDestinationInvoice({
      metadata,
      amountMsats: requested,
      blockedHosts
    })
  }

  const attemptNo = lastAttemptNo + 1
  const requestId = createHash('sha256')
    .update(
      `${receipt.walletId}|${invoice.paymentHash.toLowerCase()}|${batch.anchorId}|${attemptNo}`
    )
    .digest('hex')
  let attempt: RemoteWalletForwardAttempt | null = null
  try {
    attempt = await prisma.$transaction(async tx => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${receipt.walletId}, 0))
      `
      const activeAction = await tx.remoteWalletReceiveAction.findFirst({
        where: {
          id: receipt.actionId,
          enabled: true,
          leaseOwner: receipt.leaseOwner
        },
        select: { id: true }
      })
      if (!activeAction) return null
      const eligibleLegs = await tx.remoteWalletForwardLeg.findMany({
        where: {
          destination: leg.destination,
          status: { in: ['READY', 'REJECTED', 'EXPIRED'] },
          receipt: { actionId: receipt.actionId },
          OR: [
            { batchAnchorId: batch.anchorId },
            { batchAnchorId: null, status: 'READY' }
          ]
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
      const persistedAmount = eligibleLegs.reduce(
        (sum, candidate) => sum + candidate.requestedAmountMsats,
        BigInt(0)
      )
      if (
        eligibleLegs.length === 0 ||
        persistedAmount !== requestedAmountMsats
      ) {
        return null
      }
      await tx.remoteWalletForwardLeg.updateMany({
        where: { id: { in: eligibleLegs.map(candidate => candidate.id) } },
        data: {
          batchAnchorId: batch.anchorId,
          status: 'PENDING',
          routingReserveMsats: BigInt(0),
          lastError: null
        }
      })
      const created = await tx.remoteWalletForwardAttempt.create({
        data: {
          legId: batch.anchorId,
          attemptNo,
          bolt11: invoice.bolt11,
          paymentHash: invoice.paymentHash,
          amountMsats: BigInt(invoice.amountMsats),
          routingReserveMsats,
          expiresAt: invoice.expiresAt,
          requestId
        }
      })
      const reserveShares = allocateByWeight(
        routingReserveMsats,
        eligibleLegs.map(candidate => ({
          id: candidate.id,
          weight: candidate.requestedAmountMsats
        }))
      )
      const nextRetryAt = new Date(Date.now() + RETRY_MS)
      for (const candidate of eligibleLegs) {
        await tx.remoteWalletForwardLeg.updateMany({
          where: {
            id: candidate.id,
            batchAnchorId: batch.anchorId,
            status: 'PENDING'
          },
          data: {
            routingReserveMsats: reserveShares.get(candidate.id) ?? BigInt(0),
            nextRetryAt
          }
        })
      }
      return created
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    await rejectPendingBatch(
      batch.members.map(member => member.id),
      'Destination invoice is already owned by another forwarding operation'
    )
    return
  }
  if (!attempt) return
  emitForwardingUpdated()

  const bridge = await getListenerConfig()
  let result
  try {
    result = await listenerNwcPayment(bridge, {
      requestId,
      walletId: receipt.walletId,
      invoice: invoice.bolt11,
      paymentHash: invoice.paymentHash,
      idempotencyScope: batch.anchorId,
      attemptNo,
      waitMs: 8000
    })
  } catch (error) {
    if (!(error instanceof ListenerPaymentAmbiguousError)) throw error
    await markAttempt(attempt.id, 'UNKNOWN', 'transport_unknown', error.message)
    await setBatchLegState(batch.anchorId, 'UNKNOWN', error.message)
    return
  }
  if (result.ok) {
    await settleAttempt(attempt, result.preimage, result.feesPaidMsats)
    await completeBatch(receipt.id, batch.anchorId, {
      ...attempt,
      preimage: result.preimage,
      routingFeeMsats: BigInt(result.feesPaidMsats)
    })
    return
  }
  const status =
    result.status === 'pending'
      ? 'PENDING'
      : result.status === 'unknown'
        ? 'UNKNOWN'
        : 'REJECTED'
  await markAttempt(
    attempt.id,
    status,
    paymentErrorCode(result) ?? result.status,
    result.error?.message ?? null
  )
  await setBatchLegState(
    batch.anchorId,
    status,
    result.error?.message ?? result.status,
    status === 'REJECTED'
  )
}

async function loadForwardingBatch(
  receipt: ReceiptWithRelations,
  leg: RemoteWalletForwardLeg & { attempts: RemoteWalletForwardAttempt[] },
  includeWaiting: boolean
): Promise<{
  anchorId: string
  members: RemoteWalletForwardLeg[]
  latest: RemoteWalletForwardAttempt | null
}> {
  const existingBatch = leg.batchAnchorId
    ? null
    : await prisma.remoteWalletForwardLeg.findFirst({
        where: {
          destination: leg.destination,
          batchAnchorId: { not: null },
          status: { in: ['READY', 'REJECTED', 'EXPIRED'] },
          receipt: { actionId: receipt.actionId }
        },
        select: { batchAnchorId: true },
        orderBy: { createdAt: 'asc' }
      })
  const anchorId = leg.batchAnchorId ?? existingBatch?.batchAnchorId ?? leg.id
  const members =
    anchorId !== leg.id || leg.batchAnchorId
      ? await prisma.remoteWalletForwardLeg.findMany({
          where: { batchAnchorId: anchorId, status: { not: 'SUPERSEDED' } }
        })
      : [leg]
  if (includeWaiting) {
    const waiting = await prisma.remoteWalletForwardLeg.findMany({
      where: {
        destination: leg.destination,
        batchAnchorId: null,
        status: 'READY',
        requestedAmountMsats: { gt: BigInt(0) },
        receipt: { actionId: receipt.actionId }
      }
    })
    const known = new Set(members.map(member => member.id))
    members.push(...waiting.filter(member => !known.has(member.id)))
  }
  const latest =
    leg.attempts[0] ??
    (anchorId !== leg.id || leg.batchAnchorId
      ? await prisma.remoteWalletForwardAttempt.findFirst({
          where: { legId: anchorId },
          orderBy: { attemptNo: 'desc' }
        })
      : null)
  return { anchorId, members, latest }
}

async function blockUntilMorePendingFunds(ids: string[]): Promise<void> {
  const nextRetryAt = new Date(Date.now() + RETRY_MS)
  await prisma.$transaction(async tx => {
    await tx.remoteWalletForwardLeg.updateMany({
      where: { id: { in: ids }, status: { not: 'SUCCEEDED' } },
      data: {
        status: 'READY',
        batchAnchorId: null,
        routingReserveMsats: BigInt(0),
        lastError: FORWARDING_AMOUNT_TOO_SMALL_ERROR,
        nextRetryAt
      }
    })
    await tx.remoteWalletForwardReceipt.updateMany({
      where: {
        status: { in: ['RECEIVED', 'FORWARDING', 'PARTIAL', 'BLOCKED'] },
        legs: { some: { id: { in: ids } } }
      },
      data: {
        status: 'BLOCKED',
        lastError: FORWARDING_AMOUNT_TOO_SMALL_ERROR,
        nextRetryAt
      }
    })
  })
}

async function rejectPendingBatch(
  ids: string[],
  message: string
): Promise<void> {
  await prisma.remoteWalletForwardLeg.updateMany({
    where: { id: { in: ids }, status: { not: 'SUCCEEDED' } },
    data: {
      status: 'REJECTED',
      retryCount: { increment: 1 },
      nextRetryAt: new Date(Date.now() + RETRY_MS),
      lastError: message
    }
  })
}

async function setBatchLegState(
  anchorId: string,
  status: 'PENDING' | 'UNKNOWN' | 'REJECTED' | 'EXPIRED',
  lastError: string | null,
  incrementRetry = false
): Promise<void> {
  await prisma.remoteWalletForwardLeg.updateMany({
    where: { batchAnchorId: anchorId, status: { not: 'SUCCEEDED' } },
    data: {
      status,
      retryCount: { increment: incrementRetry ? 1 : 0 },
      nextRetryAt: new Date(Date.now() + RETRY_MS),
      lastError
    }
  })
}

async function reconcileAttempt(
  receipt: ReceiptWithRelations,
  attempt: RemoteWalletForwardAttempt
): Promise<'SUCCEEDED' | 'RETRY' | 'WAIT'> {
  const bridge = await getListenerConfig()
  let result = await getListenerNwcPayment(bridge, attempt.requestId)
  if (!result) {
    try {
      result = await listenerNwcPayment(bridge, {
        requestId: attempt.requestId,
        walletId: receipt.walletId,
        invoice: attempt.bolt11,
        paymentHash: attempt.paymentHash,
        idempotencyScope: attempt.legId,
        attemptNo: attempt.attemptNo,
        waitMs: 8000
      })
    } catch (error) {
      if (error instanceof ListenerPaymentAmbiguousError) return 'WAIT'
      throw error
    }
  }
  if (result.ok) {
    await settleAttempt(attempt, result.preimage, result.feesPaidMsats)
    return 'SUCCEEDED'
  }
  if (result.status === 'pending' || result.status === 'unknown') {
    await markAttempt(
      attempt.id,
      result.status === 'pending' ? 'PENDING' : 'UNKNOWN',
      paymentErrorCode(result) ?? result.status,
      result.error?.message ?? null
    )
    if (attempt.expiresAt > new Date()) return 'WAIT'
    return resolveExpiredAttempt(receipt, attempt)
  }
  await markAttempt(
    attempt.id,
    'REJECTED',
    paymentErrorCode(result) ?? result.status,
    result.error?.message ?? null
  )
  return 'RETRY'
}

async function resolveExpiredAttempt(
  receipt: ReceiptWithRelations,
  attempt: RemoteWalletForwardAttempt
): Promise<'SUCCEEDED' | 'RETRY' | 'WAIT'> {
  const bridge = await getListenerConfig()
  try {
    const tx = await listenerNwcRequest<{
      state?: string
      preimage?: string
      fees_paid?: number
    }>(bridge, {
      connectionString: walletConfig(receipt).connectionString,
      method: 'lookup_invoice',
      params: { payment_hash: attempt.paymentHash }
    })
    if (tx.state === 'settled') {
      if (
        !tx.preimage ||
        !preimageMatchesPaymentHash(tx.preimage, attempt.paymentHash)
      ) {
        return 'WAIT'
      }
      await settleAttempt(attempt, tx.preimage, tx.fees_paid ?? 0)
      return 'SUCCEEDED'
    }
    if (tx.state === 'pending') return 'WAIT'
  } catch {
    return 'WAIT'
  }
  await markAttempt(attempt.id, 'EXPIRED', 'invoice_expired', null)
  return 'RETRY'
}

async function settleAttempt(
  attempt: Pick<RemoteWalletForwardAttempt, 'id' | 'paymentHash'>,
  preimage: string,
  feesPaidMsats: number
): Promise<void> {
  if (!preimageMatchesPaymentHash(preimage, attempt.paymentHash)) {
    throw new Error('Destination payment preimage does not match payment hash')
  }
  await prisma.remoteWalletForwardAttempt.updateMany({
    where: {
      id: attempt.id,
      status: { in: ['PENDING', 'UNKNOWN', 'REJECTED'] }
    },
    data: {
      status: 'SUCCEEDED',
      preimage: preimage.toLowerCase(),
      routingFeeMsats: BigInt(Math.max(0, feesPaidMsats)),
      errorCode: null,
      errorMessage: null,
      resolvedAt: new Date()
    }
  })
}

async function completeBatch(
  currentReceiptId: string,
  anchorId: string,
  attempt: Pick<
    RemoteWalletForwardAttempt,
    | 'amountMsats'
    | 'preimage'
    | 'paymentHash'
    | 'routingFeeMsats'
    | 'routingReserveMsats'
  >
): Promise<void> {
  const members = await prisma.remoteWalletForwardLeg.findMany({
    where: { batchAnchorId: anchorId, status: { not: 'SUPERSEDED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  })
  const requestedAmountMsats = members.reduce(
    (sum, member) => sum + member.requestedAmountMsats,
    BigInt(0)
  )
  const plannedInvoiceAmount =
    requestedAmountMsats - attempt.routingReserveMsats
  if (
    members.length === 0 ||
    !attempt.preimage ||
    !preimageMatchesPaymentHash(attempt.preimage, attempt.paymentHash) ||
    !isDestinationInvoiceAmountAcceptable(
      plannedInvoiceAmount,
      attempt.amountMsats
    )
  ) {
    throw new Error('Forwarding completion invariants are not satisfied')
  }
  const routingFee = attempt.routingFeeMsats ?? BigInt(0)
  const reserveShares = allocateByWeight(
    attempt.routingReserveMsats,
    members.map(member => ({
      id: member.id,
      weight: member.requestedAmountMsats
    }))
  )
  const plannedShares = members.map(member => ({
    id: member.id,
    weight:
      member.requestedAmountMsats - (reserveShares.get(member.id) ?? BigInt(0))
  }))
  const forwardedShares = allocateByWeight(attempt.amountMsats, plannedShares)
  const feeShares = allocateByWeight(
    routingFee,
    members.map(member => ({
      id: member.id,
      weight: member.requestedAmountMsats
    }))
  )
  const completedAt = new Date()
  await prisma.$transaction(
    members.map(member => {
      const reserve = reserveShares.get(member.id) ?? BigInt(0)
      const fee = feeShares.get(member.id) ?? BigInt(0)
      const forwarded = forwardedShares.get(member.id) ?? BigInt(0)
      const planned = member.requestedAmountMsats - reserve
      return prisma.remoteWalletForwardLeg.updateMany({
        where: { id: member.id, status: { not: 'SUCCEEDED' } },
        data: {
          status: 'SUCCEEDED',
          forwardedAmountMsats: forwarded,
          routingFeeMsats: fee,
          routingReserveMsats: reserve,
          unusedRoutingReserveMsats: reserve > fee ? reserve - fee : BigInt(0),
          routingFeeOverageMsats: fee > reserve ? fee - reserve : BigInt(0),
          destinationShortfallMsats: planned - forwarded,
          lastError: null,
          completedAt
        }
      })
    })
  )
  await refreshCompletedBatchReceipts(anchorId, currentReceiptId)
}

async function refreshCompletedBatchReceipts(
  anchorId: string,
  currentReceiptId: string
): Promise<void> {
  const members = await prisma.remoteWalletForwardLeg.findMany({
    where: { batchAnchorId: anchorId },
    select: { receiptId: true },
    distinct: ['receiptId']
  })
  for (const { receiptId } of members) {
    if (receiptId === currentReceiptId) continue
    await finalizeReceipt(receiptId, null, null)
  }
}

function allocateByWeight(
  total: bigint,
  rows: Array<{ id: string; weight: bigint }>
): Map<string, bigint> {
  const result = new Map(rows.map(row => [row.id, BigInt(0)]))
  if (total === BigInt(0) || rows.length === 0) return result
  const weightTotal = rows.reduce((sum, row) => sum + row.weight, BigInt(0))
  if (weightTotal <= BigInt(0)) {
    throw new Error('Forwarding batch has no allocatable weight')
  }
  const shares = rows.map((row, index) => {
    const numerator = total * row.weight
    return {
      ...row,
      index,
      amount: numerator / weightTotal,
      remainder: numerator % weightTotal
    }
  })
  let distributed = shares.reduce((sum, share) => sum + share.amount, BigInt(0))
  shares.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  )
  for (let index = 0; distributed < total; index++) {
    shares[index % shares.length].amount += BigInt(1)
    distributed += BigInt(1)
  }
  for (const share of shares) result.set(share.id, share.amount)
  return result
}

async function finalizeReceipt(
  id: string,
  workerId: string | null,
  receiptLastError: string | null
): Promise<boolean> {
  const legs = await prisma.remoteWalletForwardLeg.findMany({
    where: { receiptId: id, status: { not: 'SUPERSEDED' } }
  })
  const succeeded = legs.filter(leg => leg.status === 'SUCCEEDED')
  const forwarded = succeeded.reduce(
    (sum, leg) => sum + (leg.forwardedAmountMsats ?? BigInt(0)),
    BigInt(0)
  )
  const routing = succeeded.reduce(
    (sum, leg) => sum + (leg.routingFeeMsats ?? BigInt(0)),
    BigInt(0)
  )
  const routingReserve = legs.reduce(
    (sum, leg) => sum + leg.routingReserveMsats,
    BigInt(0)
  )
  const unusedRoutingReserve = succeeded.reduce(
    (sum, leg) => sum + leg.unusedRoutingReserveMsats,
    BigInt(0)
  )
  const routingFeeOverage = succeeded.reduce(
    (sum, leg) => sum + leg.routingFeeOverageMsats,
    BigInt(0)
  )
  const shortfall = succeeded.reduce(
    (sum, leg) => sum + leg.destinationShortfallMsats,
    BigInt(0)
  )
  const complete = legs.length > 0 && succeeded.length === legs.length
  const inFlight = legs.some(
    leg => leg.status === 'PENDING' || leg.status === 'UNKNOWN'
  )
  const waiting = legs.some(leg => leg.status === 'READY')
  const status = complete
    ? 'COMPLETED'
    : succeeded.length > 0
      ? 'PARTIAL'
      : inFlight
        ? 'FORWARDING'
        : 'BLOCKED'
  const lastError = complete
    ? null
    : (firstLegError(legs) ??
      (waiting
        ? FORWARDING_AMOUNT_TOO_SMALL_ERROR
        : legs.length === 0
          ? (receiptLastError ?? FORWARDING_AMOUNT_TOO_SMALL_ERROR)
          : null))
  const updated = await prisma.remoteWalletForwardReceipt.updateMany({
    where: workerId
      ? { id, leaseOwner: workerId }
      : {
          id,
          OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: new Date() } }]
        },
    data: {
      status,
      forwardedAmountMsats: forwarded,
      routingFeeMsats: routing,
      routingReserveMsats: routingReserve,
      unusedRoutingReserveMsats: unusedRoutingReserve,
      routingFeeOverageMsats: routingFeeOverage,
      shortfallMsats: shortfall,
      lastError,
      nextRetryAt: new Date(Date.now() + RETRY_MS),
      completedAt: complete ? new Date() : null,
      leaseOwner: null,
      leaseExpiresAt: null
    }
  })
  if (complete && updated.count > 0) {
    const deliveryIds = await enqueueForwardedReceiptNotifications(id)
    if (deliveryIds.length > 0) {
      try {
        await reconcileRemoteWalletNotifications({ ids: deliveryIds })
      } catch (error) {
        // The journal is already durable; notification transport must never
        // roll back or mask a successful Lightning forwarding receipt.
        logger.warn(
          { err: error, remoteWalletForwardReceiptId: id },
          'remote_wallet_notification.reconcile_deferred'
        )
      }
    }
  }
  return complete
}

async function markAttempt(
  id: string,
  status: 'PENDING' | 'UNKNOWN' | 'REJECTED' | 'EXPIRED',
  errorCode: string,
  errorMessage: string | null
): Promise<void> {
  await prisma.remoteWalletForwardAttempt.updateMany({
    where: { id, status: { in: ['PENDING', 'UNKNOWN', 'REJECTED'] } },
    data: {
      status,
      errorCode,
      errorMessage,
      resolvedAt:
        status === 'REJECTED' || status === 'EXPIRED' ? new Date() : null
    }
  })
}

async function release(
  id: string,
  workerId: string,
  status: RemoteWalletForwardReceipt['status'],
  lastError: string | null
): Promise<void> {
  await prisma.remoteWalletForwardReceipt.updateMany({
    where: { id, leaseOwner: workerId },
    data: {
      status,
      lastError,
      nextRetryAt: new Date(Date.now() + RETRY_MS),
      leaseOwner: null,
      leaseExpiresAt: null
    }
  })
}

async function releaseActionLease(
  receiptId: string,
  workerId: string
): Promise<void> {
  await prisma.remoteWalletReceiveAction.updateMany({
    where: {
      leaseOwner: workerId,
      receipts: { some: { id: receiptId } }
    },
    data: { leaseOwner: null, leaseExpiresAt: null }
  })
}

async function hydrateRejectedWalletError(
  attempt: RemoteWalletForwardAttempt | null
): Promise<RemoteWalletForwardAttempt | null> {
  if (
    !attempt ||
    attempt.status !== 'REJECTED' ||
    attempt.errorCode !== 'wallet_error'
  ) {
    return attempt
  }
  try {
    const bridge = await getListenerConfig()
    const result = await getListenerNwcPayment(bridge, attempt.requestId)
    if (!result || result.ok || result.status !== 'rejected') return attempt
    const rawCode = result.error?.walletErrorCode
    if (!rawCode) return attempt
    await prisma.remoteWalletForwardAttempt.updateMany({
      where: { id: attempt.id, status: 'REJECTED', errorCode: 'wallet_error' },
      data: { errorCode: rawCode }
    })
    return { ...attempt, errorCode: rawCode }
  } catch {
    return attempt
  }
}

function isInsufficientBalance(
  attempt: Pick<
    RemoteWalletForwardAttempt,
    'status' | 'errorCode' | 'errorMessage'
  > | null
): boolean {
  return (
    attempt?.status === 'REJECTED' &&
    (attempt.errorCode?.toUpperCase() === 'INSUFFICIENT_BALANCE' ||
      attempt.errorMessage?.toLowerCase().includes('insufficient balance') ===
        true)
  )
}

function nextRoutingReserve(
  requestedAmountMsats: bigint,
  previous: Pick<RemoteWalletForwardAttempt, 'routingReserveMsats'> | null
): bigint {
  const base = calculateRoutingReserve(requestedAmountMsats).routingReserveMsats
  if (!previous) return base
  const increased =
    previous.routingReserveMsats > BigInt(0)
      ? previous.routingReserveMsats * BigInt(2)
      : base
  return increased >= requestedAmountMsats
    ? requestedAmountMsats
    : increased > base
      ? increased
      : base
}

function paymentErrorCode(result: {
  error?: { code: string; walletErrorCode?: string }
}): string | null {
  return result.error?.walletErrorCode ?? result.error?.code ?? null
}

function walletConfig(receipt: ReceiptWithRelations): {
  connectionString: string
} {
  if (receipt.wallet.type !== 'NWC')
    throw new Error('Forwarding wallet is not NWC')
  return decryptRemoteWalletConfig(
    receipt.wallet.id,
    receipt.wallet.type,
    receipt.wallet.config
  ) as { connectionString: string }
}

async function localBlockedHosts(): Promise<string[]> {
  const [publicEndpoint, apiUrl] = await Promise.all([
    resolvePublicEndpoint(),
    resolveApiUrl()
  ])
  return [publicEndpoint.host, new URL(apiUrl).hostname]
}

function firstLegError(legs: RemoteWalletForwardLeg[]): string | null {
  return legs.find(leg => leg.lastError)?.lastError ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Forwarding failed'
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ((error as { code?: string }).code === 'P2002' ||
      (error as { code?: string }).code === '23505')
  )
}
