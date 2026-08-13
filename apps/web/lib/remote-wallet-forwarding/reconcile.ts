import { createHash, randomUUID } from 'node:crypto'
import type {
  RemoteWalletForwardAttempt,
  RemoteWalletForwardLeg,
  RemoteWalletForwardReceipt
} from '@/lib/generated/prisma'
import { preimageMatchesPaymentHash } from '@/lib/card-payments/lifecycle'
import { getListenerConfig } from '@/lib/listener-config'
import { errorMessage } from '@/lib/error-message'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  fetchDestinationMetadata,
  requestDestinationInvoice
} from '@/lib/proxy/lnurl'
import { isDestinationInvoiceAmountAcceptable } from '@/lib/proxy/money'
import { localBlockedHosts } from '@/lib/proxy/local-hosts'
import { resolveLocalDestination } from '@/lib/proxy/local-destination'
import {
  FORWARD_HOP_LIMIT_ERROR,
  getForwardDepth,
  isForwardDepthExhausted,
  recordForwardHop
} from '@/lib/proxy/forward-hops'
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
  FORWARDING_AMOUNT_TOO_SMALL_ERROR,
  largestRemainderShares
} from './money'
import { sweepMissedPayments } from './capture-sweep'
import { emitForwardingUpdated } from './service'
import { enqueueForwardedReceiptNotifications } from '@/lib/remote-wallet-notifications/service'
import { reconcileRemoteWalletNotifications } from '@/lib/remote-wallet-notifications/reconcile'
import {
  PROXY_BATCH_SIZE as BATCH_SIZE,
  PROXY_LEASE_MS as LEASE_MS,
  PROXY_RETRY_INTERVAL_MS as RETRY_MS
} from '@/lib/proxy/constants'

const INSUFFICIENT_BALANCE_ERROR =
  'The source wallet does not have enough balance to cover this forward and its routing fee.'

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
  // Recover payments whose `payment_received` webhook was never delivered
  // before claiming: capture is the only producer of receipts, so without
  // this a lost delivery strands the funds permanently. Never fatal — the
  // receipts already on the books still have to move.
  try {
    await sweepMissedPayments({ walletIds: options.walletIds })
  } catch (error) {
    logger.warn({ err: error }, 'remote_wallet_forwarding.capture_sweep_failed')
  }
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
      const message = errorMessage(error, 'Forwarding failed')
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
    const reloaded = await loadReceipt(id)
    if (!reloaded) return false
    receipt = reloaded
    if (receipt.status === 'RETAINED') {
      await prisma.remoteWalletForwardReceipt.updateMany({
        where: { id: receipt.id, leaseOwner: workerId },
        data: { leaseOwner: null, leaseExpiresAt: null }
      })
      return true
    }
  }

  await materializePendingLegs(receipt.actionId)
  const materialized = await loadReceipt(id)
  if (!materialized) return false
  receipt = materialized

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
    // An earlier leg in this loop may have settled this one as part of its
    // batch. Re-reading avoids minting a second destination invoice for money
    // that has already been forwarded.
    const current = await prisma.remoteWalletForwardLeg.findUnique({
      where: { id: leg.id },
      select: { status: true }
    })
    if (
      !current ||
      current.status === 'SUCCEEDED' ||
      current.status === 'SUPERSEDED'
    ) {
      continue
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
    // materializePendingLegs may have raced us onto the same receipt; creating
    // a second set would collide on (receiptId, position).
    const existing = await tx.remoteWalletForwardLeg.count({
      where: { receiptId: receipt.id }
    })
    if (existing > 0) return
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

  // A wallet can report a failure for a payment whose HTLC actually settled.
  // Paying again would send the destination the same money twice, so prove the
  // rejection before building another attempt.
  if (latest?.status === 'REJECTED') {
    const settled = await settleIfPaidDespiteRejection(receipt, latest)
    if (settled) {
      await completeBatch(receipt.id, batch.anchorId, settled)
      return
    }
  }

  const insufficientBalance = isInsufficientBalance(latest)
  const requestedAmountMsats = batch.members.reduce(
    (sum, member) => sum + member.requestedAmountMsats,
    BigInt(0)
  )
  if (requestedAmountMsats <= BigInt(0)) {
    logger.warn(
      { batchAnchorId: batch.anchorId, remoteWalletForwardLegId: leg.id },
      'remote_wallet_forwarding.batch_has_no_amount'
    )
    await blockUntilMorePendingFunds([
      leg.id,
      ...batch.members.map(member => member.id)
    ])
    return
  }
  const routingReserveMsats = nextRoutingReserve(
    requestedAmountMsats,
    insufficientBalance ? latest : null
  )
  const invoiceAmountMsats = requestedAmountMsats - routingReserveMsats
  if (invoiceAmountMsats <= BigInt(0)) {
    // The escalated reserve swallowed the whole amount, which only happens
    // after repeated insufficient-balance rejections. Say so instead of
    // blaming the payment size.
    await blockUntilMorePendingFunds(
      batch.members.map(member => member.id),
      insufficientBalance ? INSUFFICIENT_BALANCE_ERROR : undefined
    )
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
  // Forwarding to an address on this instance is allowed, so the money we send
  // can come back to us as another forwardable payment. Cut the chain before
  // minting a new invoice, not after, so a cycle costs nothing.
  const local = await resolveLocalDestination(leg.destination)
  // Only a local hop is ever stamped, and only a local destination can send the
  // money back to us — so a forward that leaves the instance never pays for the
  // lookup.
  const depth = local ? await getForwardDepth(receipt.sourcePaymentHash) : 0
  if (local && isForwardDepthExhausted(depth)) {
    await rejectPendingBatch(
      batch.members.map(member => member.id),
      FORWARD_HOP_LIMIT_ERROR
    )
    return
  }

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
    if (local) await recordForwardHop(invoice.paymentHash, depth + 1)
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
      const reserveShares = largestRemainderShares(
        routingReserveMsats,
        eligibleLegs.map(candidate => candidate.requestedAmountMsats)
      )
      const nextRetryAt = new Date(Date.now() + RETRY_MS)
      for (const [index, candidate] of eligibleLegs.entries()) {
        await tx.remoteWalletForwardLeg.updateMany({
          where: {
            id: candidate.id,
            batchAnchorId: batch.anchorId,
            status: 'PENDING'
          },
          data: {
            routingReserveMsats: reserveShares[index],
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
  if (!attempt) {
    // The action lease or the eligible-leg set changed under us after the
    // destination already minted an invoice. Back off so a hot loop cannot
    // mint one per pass.
    logger.warn(
      {
        batchAnchorId: batch.anchorId,
        remoteWalletForwardLegId: leg.id,
        paymentHash: invoice.paymentHash
      },
      'remote_wallet_forwarding.attempt_not_persisted'
    )
    await prisma.remoteWalletForwardLeg.updateMany({
      where: { id: { in: batch.members.map(member => member.id) } },
      data: { nextRetryAt: new Date(Date.now() + RETRY_MS) }
    })
    return
  }
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

async function blockUntilMorePendingFunds(
  ids: string[],
  reason: string = FORWARDING_AMOUNT_TOO_SMALL_ERROR
): Promise<void> {
  const nextRetryAt = new Date(Date.now() + RETRY_MS)
  await prisma.$transaction(async tx => {
    await tx.remoteWalletForwardLeg.updateMany({
      where: { id: { in: ids }, status: { not: 'SUCCEEDED' } },
      data: {
        status: 'READY',
        batchAnchorId: null,
        routingReserveMsats: BigInt(0),
        lastError: reason,
        nextRetryAt
      }
    })
    await tx.remoteWalletForwardReceipt.updateMany({
      where: {
        status: { in: ['RECEIVED', 'FORWARDING', 'PARTIAL', 'BLOCKED'] },
        legs: { some: { id: { in: ids }, residual: false } }
      },
      data: {
        status: 'BLOCKED',
        lastError: reason,
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

/**
 * Ask the source wallet whether a rejected attempt actually settled. Returns
 * the settled attempt when it did, so the caller completes the batch instead
 * of paying the destination a second time.
 */
async function settleIfPaidDespiteRejection(
  receipt: ReceiptWithRelations,
  attempt: RemoteWalletForwardAttempt
): Promise<RemoteWalletForwardAttempt | null> {
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
    if (
      tx.state !== 'settled' ||
      !tx.preimage ||
      !preimageMatchesPaymentHash(tx.preimage, attempt.paymentHash)
    ) {
      return null
    }
    logger.warn(
      {
        remoteWalletForwardAttemptId: attempt.id,
        paymentHash: attempt.paymentHash
      },
      'remote_wallet_forwarding.rejected_attempt_actually_settled'
    )
    await settleAttempt(attempt, tx.preimage, tx.fees_paid ?? 0)
    return prisma.remoteWalletForwardAttempt.findUnique({
      where: { id: attempt.id }
    })
  } catch {
    // The destination invoice is unknown to the wallet, or the bridge is down.
    // Treat the rejection as genuine and let the normal retry path run.
    return null
  }
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
      status: { in: ['PENDING', 'UNKNOWN', 'REJECTED', 'EXPIRED'] }
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
  // The destination has already been paid by the time this runs, so nothing
  // here may throw: an exception would mark the receipt BLOCKED and re-enter
  // this function forever while the money is gone.
  if (members.length === 0) {
    logger.error(
      { batchAnchorId: anchorId, paymentHash: attempt.paymentHash },
      'remote_wallet_forwarding.completed_batch_without_members'
    )
    return
  }
  if (
    !attempt.preimage ||
    !preimageMatchesPaymentHash(attempt.preimage, attempt.paymentHash)
  ) {
    logger.error(
      { batchAnchorId: anchorId, paymentHash: attempt.paymentHash },
      'remote_wallet_forwarding.settled_attempt_preimage_invalid'
    )
    await rejectPendingBatch(
      members.map(member => member.id),
      'Forwarding settlement could not be proven; contact support before retrying'
    )
    return
  }
  const requestedAmountMsats = members.reduce(
    (sum, member) => sum + member.requestedAmountMsats,
    BigInt(0)
  )
  const plannedInvoiceAmount =
    requestedAmountMsats - attempt.routingReserveMsats
  if (
    !isDestinationInvoiceAmountAcceptable(
      plannedInvoiceAmount,
      attempt.amountMsats
    )
  ) {
    // Batch membership changed after the attempt was created. The paid amount
    // is authoritative; distribute it over the members that exist now.
    logger.warn(
      {
        batchAnchorId: anchorId,
        paymentHash: attempt.paymentHash,
        plannedInvoiceAmount: plannedInvoiceAmount.toString(),
        paidAmountMsats: attempt.amountMsats.toString()
      },
      'remote_wallet_forwarding.batch_membership_drifted'
    )
  }
  const routingFee = attempt.routingFeeMsats ?? BigInt(0)
  const weights = members.map(member => member.requestedAmountMsats)
  const reserveShares = largestRemainderShares(
    attempt.routingReserveMsats,
    weights
  )
  const forwardedShares = largestRemainderShares(
    attempt.amountMsats,
    members.map((member, index) => member.requestedAmountMsats - reserveShares[index])
  )
  const feeShares = largestRemainderShares(routingFee, weights)
  const completedAt = new Date()
  const residuals: Array<{
    receiptId: string
    destination: string
    amountMsats: bigint
  }> = []
  await prisma.$transaction(
    members.map((member, index) => {
      const reserve = reserveShares[index]
      const fee = feeShares[index]
      const forwarded = forwardedShares[index]
      const planned = member.requestedAmountMsats - reserve
      const unused = reserve > fee ? reserve - fee : BigInt(0)
      if (unused > BigInt(0) && !member.residual) {
        residuals.push({
          receiptId: member.receiptId,
          destination: member.destination,
          amountMsats: unused
        })
      }
      return prisma.remoteWalletForwardLeg.updateMany({
        where: { id: member.id, status: { not: 'SUCCEEDED' } },
        data: {
          status: 'SUCCEEDED',
          forwardedAmountMsats: forwarded,
          routingFeeMsats: fee,
          routingReserveMsats: reserve,
          unusedRoutingReserveMsats: unused,
          routingFeeOverageMsats: fee > reserve ? fee - reserve : BigInt(0),
          destinationShortfallMsats: planned - forwarded,
          lastError: null,
          completedAt
        }
      })
    })
  )
  await carryUnusedReserve(anchorId, residuals)
  await refreshCompletedBatchReceipts(anchorId, currentReceiptId)
}

/**
 * An unused routing reserve is money the destination is still owed. Park it on
 * a residual leg so the next batch to the same destination picks it up instead
 * of leaving it stranded in the source wallet.
 */
async function carryUnusedReserve(
  anchorId: string,
  residuals: Array<{
    receiptId: string
    destination: string
    amountMsats: bigint
  }>
): Promise<void> {
  if (residuals.length === 0) return
  const byDestination = new Map<string, { receiptId: string; total: bigint }>()
  for (const residual of residuals) {
    const current = byDestination.get(residual.destination)
    byDestination.set(residual.destination, {
      receiptId: current?.receiptId ?? residual.receiptId,
      total: (current?.total ?? BigInt(0)) + residual.amountMsats
    })
  }
  for (const [destination, { receiptId, total }] of byDestination) {
    try {
      await prisma.$transaction(async tx => {
        const receipt = await tx.remoteWalletForwardReceipt.findUnique({
          where: { id: receiptId },
          select: { actionId: true }
        })
        if (!receipt) return
        // One open residual leg per destination keeps the carry bounded no
        // matter how many forwards run.
        const open = await tx.remoteWalletForwardLeg.findFirst({
          where: {
            destination,
            residual: true,
            status: 'READY',
            receipt: { actionId: receipt.actionId }
          },
          orderBy: { createdAt: 'asc' }
        })
        if (open) {
          await tx.remoteWalletForwardLeg.update({
            where: { id: open.id },
            data: {
              requestedAmountMsats: open.requestedAmountMsats + total,
              nextRetryAt: new Date()
            }
          })
          return
        }
        const last = await tx.remoteWalletForwardLeg.findFirst({
          where: { receiptId },
          orderBy: { position: 'desc' },
          select: { position: true }
        })
        await tx.remoteWalletForwardLeg.create({
          data: {
            receiptId,
            position: (last?.position ?? -1) + 1,
            destination,
            allocationBps: 0,
            requestedAmountMsats: total,
            residual: true,
            lastError: FORWARDING_AMOUNT_TOO_SMALL_ERROR
          }
        })
      })
    } catch (error) {
      // Losing the carry must never undo a settled forwarding batch.
      logger.warn(
        { err: error, batchAnchorId: anchorId, destination },
        'remote_wallet_forwarding.residual_carry_failed'
      )
    }
  }
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
  // Residual legs carry an unused reserve forward; they owe the destination
  // real money but must not hold the originating receipt open forever.
  const settlementLegs = legs.filter(leg => !leg.residual)
  const complete =
    settlementLegs.length > 0 &&
    settlementLegs.every(leg => leg.status === 'SUCCEEDED')
  const inFlight = legs.some(
    leg => leg.status === 'PENDING' || leg.status === 'UNKNOWN'
  )
  const waiting = settlementLegs.some(leg => leg.status === 'READY')
  const status = complete
    ? 'COMPLETED'
    : succeeded.length > 0
      ? 'PARTIAL'
      : inFlight
        ? 'FORWARDING'
        : 'BLOCKED'
  const lastError = complete
    ? null
    : (firstLegError(settlementLegs) ??
      (waiting
        ? FORWARDING_AMOUNT_TOO_SMALL_ERROR
        : settlementLegs.length === 0
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
  if (updated.count === 0) {
    // Another worker holds the lease; it will finalize on its own pass. Logged
    // because a persistent stream of these means leases are not being released.
    logger.debug(
      { remoteWalletForwardReceiptId: id, workerId },
      'remote_wallet_forwarding.finalize_skipped_leased'
    )
  }
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

const INSUFFICIENT_BALANCE_PHRASES = [
  'insufficient balance',
  'insufficient funds',
  'not enough balance',
  'not enough funds',
  'balance too low'
]

function isInsufficientBalance(
  attempt: Pick<
    RemoteWalletForwardAttempt,
    'status' | 'errorCode' | 'errorMessage'
  > | null
): boolean {
  if (attempt?.status !== 'REJECTED') return false
  if (attempt.errorCode?.toUpperCase().replaceAll(' ', '_') ===
    'INSUFFICIENT_BALANCE') {
    return true
  }
  const message = attempt.errorMessage?.toLowerCase() ?? ''
  return INSUFFICIENT_BALANCE_PHRASES.some(phrase => message.includes(phrase))
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

function firstLegError(legs: RemoteWalletForwardLeg[]): string | null {
  return legs.find(leg => leg.lastError)?.lastError ?? null
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
