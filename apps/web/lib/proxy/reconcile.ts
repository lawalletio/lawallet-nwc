import { createHash, randomUUID } from 'node:crypto'
import type { ProxyForwardAttempt, ProxyPayment } from '@/lib/generated/prisma'
import type { Event } from 'nostr-tools'
import { eventBus } from '@/lib/events/event-bus'
import { errorMessage } from '@/lib/error-message'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getListenerConfig } from '@/lib/listener-config'
import {
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest
} from '@/lib/wallet/drivers/listener-transport'
import { preimageMatchesPaymentHash } from '@/lib/card-payments/lifecycle'
import { getProxySettlementConfig } from './config'
import { resolveLocalDestination } from './local-destination'
import {
  FORWARD_HOP_LIMIT_ERROR,
  getForwardDepth,
  isForwardDepthExhausted,
  recordForwardHop
} from './forward-hops'
import {
  PROXY_BATCH_SIZE,
  PROXY_LEASE_MS,
  PROXY_RETRY_INTERVAL_MS
} from './constants'
import { fetchDestinationMetadata, requestDestinationInvoice } from './lnurl'
import { isDestinationInvoiceAmountAcceptable } from './money'
import { publishZapReceipt } from './nostr'

type PaymentWithAttempts = ProxyPayment & {
  invoice: {
    id: string
    bolt11: string
    paymentHash: string
    status: 'PENDING' | 'PAID' | 'EXPIRED'
    preimage: string | null
    paidAt: Date | null
    expiresAt: Date
  }
  attempts: ProxyForwardAttempt[]
}

export interface ReconcileProxyResult {
  claimed: number
  completed: number
  failed: number
}

export async function reconcileProxyPayments(
  options: {
    ids?: string[]
    limit?: number
    /** Deterministic worker identity for tests; production always generates it. */
    workerId?: string
  } = {}
): Promise<ReconcileProxyResult> {
  await prisma.proxyInvoiceIntent
    .deleteMany({ where: { expiresAt: { lte: new Date() } } })
    .catch(() => {})
  const workerId = options.workerId ?? randomUUID()
  const ids = await claimDuePayments(
    workerId,
    options.ids,
    Math.min(PROXY_BATCH_SIZE, Math.max(1, options.limit ?? PROXY_BATCH_SIZE))
  )
  if (ids.length > 0) emitProxyActivityUpdated()
  const outcomes = await Promise.all(
    ids.map(async id => {
      try {
        const outcome = (await reconcileOne(id, workerId))
          ? 'completed'
          : 'pending'
        emitProxyActivityUpdated()
        return outcome
      } catch (err) {
        const message = errorMessage(err)
        logger.error({ err, proxyPaymentId: id }, 'proxy.reconcile_failed')
        await releaseWithError(id, workerId, message)
        emitProxyActivityUpdated()
        return 'failed'
      }
    })
  )
  let completed = 0
  let failed = 0
  for (const outcome of outcomes) {
    if (outcome === 'completed') completed++
    if (outcome === 'failed') failed++
  }
  await prisma.proxyServiceConfig
    .updateMany({
      where: { id: 'default' },
      data: { lastCronAt: new Date() }
    })
    .catch(() => {})
  return { claimed: ids.length, completed, failed }
}

async function claimDuePayments(
  workerId: string,
  requestedIds: string[] | undefined,
  limit: number
): Promise<string[]> {
  const normalizedIds = [
    ...new Set(
      (requestedIds ?? []).filter(id => typeof id === 'string' && id.length > 0)
    )
  ].slice(0, PROXY_BATCH_SIZE)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidates AS (
      SELECT p."id"
      FROM "ProxyPayment" p
      WHERE p."status" IN (
        'PENDING_INBOUND'::"ProxyPaymentStatus",
        'READY_TO_FORWARD'::"ProxyPaymentStatus",
        'FORWARDING'::"ProxyPaymentStatus",
        'RECEIPT_PENDING'::"ProxyPaymentStatus",
        'BLOCKED'::"ProxyPaymentStatus"
      )
        AND p."nextRetryAt" <= CURRENT_TIMESTAMP
        AND (p."leaseExpiresAt" IS NULL OR p."leaseExpiresAt" < CURRENT_TIMESTAMP)
        AND (
          cardinality(${normalizedIds}::text[]) = 0
          OR p."id" = ANY(${normalizedIds}::text[])
        )
      ORDER BY p."nextRetryAt" ASC, p."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "ProxyPayment" p
       SET "leaseOwner" = ${workerId},
           "leaseExpiresAt" = CURRENT_TIMESTAMP + (${PROXY_LEASE_MS} * INTERVAL '1 millisecond'),
           "status" = CASE
             WHEN p."status" = 'READY_TO_FORWARD'::"ProxyPaymentStatus"
               THEN 'FORWARDING'::"ProxyPaymentStatus"
             ELSE p."status"
           END,
           "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
     WHERE p."id" = candidates."id"
    RETURNING p."id"
  `
  return rows.map(row => row.id)
}

async function reconcileOne(id: string, workerId: string): Promise<boolean> {
  const config = await getProxySettlementConfig()
  if (!config) throw new Error('LUD-16 proxy is disabled or unconfigured')
  const payment = await prisma.proxyPayment.findUnique({
    where: { id },
    include: {
      invoice: {
        select: {
          id: true,
          bolt11: true,
          paymentHash: true,
          status: true,
          preimage: true,
          paidAt: true,
          expiresAt: true
        }
      },
      attempts: { orderBy: { attemptNo: 'desc' }, take: 1 }
    }
  })
  if (!payment || payment.leaseOwner !== workerId) return false
  const current = payment as PaymentWithAttempts

  // BLOCKED can describe an error in any stage. Always prove inbound
  // settlement from the source Invoice snapshot before touching LNURL.
  if (current.invoice.status !== 'PAID' || !current.sourcePaidAt) {
    const sourceReady = await reconcileSourceInvoice(
      current,
      config.connectionString
    )
    if (!sourceReady) {
      await releaseForRetry(current.id, workerId, 'PENDING_INBOUND')
      return false
    }
    current.status = 'FORWARDING'
  }

  const latest = current.attempts[0] ?? null
  const succeeded =
    latest?.status === 'SUCCEEDED'
      ? latest
      : await prisma.proxyForwardAttempt.findFirst({
          where: { proxyPaymentId: current.id, status: 'SUCCEEDED' },
          orderBy: { resolvedAt: 'asc' }
        })
  if (succeeded) {
    return finishForwarding(
      current,
      succeeded,
      workerId,
      config.receiptPrivateKey
    )
  }

  // A rejected attempt can normally reuse the same still-valid BOLT11. When
  // the owner deliberately changes the destination, the recovery endpoint
  // marks that attempt as superseded so no retry can pay the old recipient.
  let reusable: ProxyForwardAttempt | null =
    latest?.errorCode === 'destination_changed' ? null : latest
  if (latest && ['PENDING', 'UNKNOWN'].includes(latest.status)) {
    const resolution = await reconcileExistingAttempt(
      latest,
      config.row.walletId
    )
    if (resolution === 'SUCCEEDED') {
      const settled = await prisma.proxyForwardAttempt.findUnique({
        where: { id: latest.id }
      })
      if (!settled) throw new Error('Settled proxy attempt disappeared')
      return finishForwarding(
        current,
        settled,
        workerId,
        config.receiptPrivateKey
      )
    }
    if (resolution === 'WAIT') {
      await releaseForRetry(current.id, workerId, 'FORWARDING')
      return false
    }
    reusable = await prisma.proxyForwardAttempt.findUnique({
      where: { id: latest.id }
    })
  }

  if (reusable && reusable.expiresAt <= new Date()) {
    await prisma.proxyForwardAttempt.updateMany({
      where: {
        proxyPaymentId: current.id,
        paymentHash: reusable.paymentHash,
        status: { in: ['PENDING', 'UNKNOWN', 'REJECTED'] }
      },
      data: {
        status: 'EXPIRED',
        resolvedAt: new Date(),
        errorCode: 'invoice_expired'
      }
    })
    reusable = null
  }

  let invoice: {
    bolt11: string
    paymentHash: string
    amountMsats: number
    expiresAt: Date
  } | null = null
  if (reusable) {
    invoice = {
      bolt11: reusable.bolt11,
      paymentHash: reusable.paymentHash,
      amountMsats: Number(reusable.amountMsats),
      expiresAt: reusable.expiresAt
    }
  } else {
    // A destination on this instance can forward the money onward, so the same
    // payment could reach us again. Stop before minting another invoice.
    const local = await resolveLocalDestination(current.destination)
    const depth = await getForwardDepth(current.invoice.paymentHash)
    if (local && isForwardDepthExhausted(depth)) {
      throw new Error(FORWARD_HOP_LIMIT_ERROR)
    }
    // This is deliberately the first point at which the destination callback
    // is called: the payer-facing source invoice is already confirmed paid.
    const metadata = await fetchDestinationMetadata(current.destination, {
      blockedHosts: current.blockedHosts
    })
    const amountMsats = Number(current.destinationAmountMsats)
    if (
      amountMsats < metadata.minSendable ||
      amountMsats > metadata.maxSendable
    ) {
      throw new Error('Destination no longer accepts the forwarded amount')
    }
    invoice = await requestDestinationInvoice({
      metadata,
      amountMsats,
      comment: current.comment,
      blockedHosts: current.blockedHosts
    })
    if (local) await recordForwardHop(invoice.paymentHash, depth + 1)
  }

  const attemptNo = (latest?.attemptNo ?? 0) + 1
  const requestId = createHash('sha256')
    .update(
      `${config.row.walletId}|${invoice.paymentHash.toLowerCase()}|${current.id}|${attemptNo}`
    )
    .digest('hex')
  const attempt = await prisma.proxyForwardAttempt.create({
    data: {
      proxyPaymentId: current.id,
      attemptNo,
      bolt11: invoice.bolt11,
      paymentHash: invoice.paymentHash,
      amountMsats: BigInt(invoice.amountMsats),
      expiresAt: invoice.expiresAt,
      requestId,
      status: 'PENDING'
    }
  })
  // Publish after the attempt is durable and before waiting on the listener.
  // The Activity tab can now show the in-flight payment immediately, while
  // the listener request remains protected by its idempotent request id.
  emitProxyActivityUpdated()

  const bridge = await getListenerConfig()
  const result = await listenerNwcPayment(bridge, {
    requestId,
    walletId: config.row.walletId,
    invoice: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    idempotencyScope: current.id,
    attemptNo,
    waitMs: 8000
  })
  if (result.ok) {
    await settleAttempt(attempt, result.preimage, result.feesPaidMsats)
    const settled = {
      ...attempt,
      status: 'SUCCEEDED' as const,
      preimage: result.preimage,
      routingFeeMsats: BigInt(result.feesPaidMsats)
    }
    return finishForwarding(
      current,
      settled,
      workerId,
      config.receiptPrivateKey
    )
  }

  const status =
    result.status === 'pending'
      ? 'PENDING'
      : result.status === 'unknown'
        ? 'UNKNOWN'
        : 'REJECTED'
  await prisma.proxyForwardAttempt.updateMany({
    where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
    data: {
      status,
      errorCode: result.error?.code ?? result.status,
      errorMessage: result.error?.message ?? null,
      ...(status === 'REJECTED' ? { resolvedAt: new Date() } : {})
    }
  })
  await releaseForRetry(current.id, workerId, 'FORWARDING')
  return false
}

async function reconcileSourceInvoice(
  payment: PaymentWithAttempts,
  connectionString: string
): Promise<boolean> {
  if (payment.invoice.status === 'PAID') {
    const paidAt = payment.invoice.paidAt ?? new Date()
    await prisma.proxyPayment.updateMany({
      where: { id: payment.id, status: 'PENDING_INBOUND' },
      data: {
        status: 'FORWARDING',
        sourcePaidAt: paidAt,
        sourcePreimage: payment.invoice.preimage
      }
    })
    payment.sourcePaidAt = paidAt
    payment.sourcePreimage = payment.invoice.preimage
    return true
  }
  const bridge = await getListenerConfig()
  const tx = await listenerNwcRequest<{
    state?: string
    preimage?: string
    settled_at?: number
    amount?: number
  }>(bridge, {
    connectionString,
    method: 'lookup_invoice',
    params: { payment_hash: payment.invoice.paymentHash }
  })
  if (tx.state !== 'settled') {
    // Always ask NWC first: a source invoice may have settled before expiry
    // while its live webhook was missed or delayed until after the timestamp.
    if (payment.invoice.expiresAt <= new Date()) {
      await prisma.$transaction([
        prisma.invoice.updateMany({
          where: { id: payment.invoice.id, status: 'PENDING' },
          data: { status: 'EXPIRED' }
        }),
        prisma.proxyPayment.updateMany({
          where: { id: payment.id, status: 'PENDING_INBOUND' },
          data: {
            status: 'EXPIRED',
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: 'Payer invoice expired before settlement'
          }
        })
      ])
    }
    return false
  }
  if (
    tx.amount !== undefined &&
    (!Number.isSafeInteger(tx.amount) ||
      BigInt(tx.amount) !== payment.grossAmountMsats)
  ) {
    throw new Error('Proxy source settlement amount does not match invoice')
  }
  if (
    tx.preimage &&
    !preimageMatchesPaymentHash(tx.preimage, payment.invoice.paymentHash)
  ) {
    throw new Error('Proxy source preimage does not match payment hash')
  }
  const paidAt = new Date(tx.settled_at ? tx.settled_at * 1000 : Date.now())
  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: payment.invoice.id },
      data: {
        status: 'PAID',
        preimage: tx.preimage ?? null,
        paidAt
      }
    }),
    prisma.proxyPayment.update({
      where: { id: payment.id },
      data: {
        status: 'FORWARDING',
        sourcePaidAt: paidAt,
        sourcePreimage: tx.preimage ?? null
      }
    })
  ])
  payment.invoice.status = 'PAID'
  payment.invoice.paidAt = paidAt
  payment.invoice.preimage = tx.preimage ?? null
  payment.sourcePaidAt = paidAt
  payment.sourcePreimage = tx.preimage ?? null
  return true
}

async function reconcileExistingAttempt(
  attempt: ProxyForwardAttempt,
  walletId: string
): Promise<'SUCCEEDED' | 'RETRY' | 'WAIT'> {
  const bridge = await getListenerConfig()
  const journal = await getListenerNwcPayment(bridge, attempt.requestId)
  if (journal?.ok) {
    await settleAttempt(attempt, journal.preimage, journal.feesPaidMsats)
    return 'SUCCEEDED'
  }
  if (journal && !journal.ok) {
    if (journal.status === 'pending' || journal.status === 'unknown') {
      await prisma.proxyForwardAttempt.updateMany({
        where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
        data: {
          status: journal.status === 'pending' ? 'PENDING' : 'UNKNOWN',
          errorCode: journal.error?.code ?? journal.status,
          errorMessage: journal.error?.message ?? null
        }
      })
      if (attempt.expiresAt <= new Date()) {
        return resolveExpiredAttempt(attempt, bridge)
      }
      return 'WAIT'
    }
    await prisma.proxyForwardAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
      data: {
        status: 'REJECTED',
        errorCode: journal.error?.code ?? journal.status,
        errorMessage: journal.error?.message ?? null,
        resolvedAt: new Date()
      }
    })
    return 'RETRY'
  }

  // If a worker crashed after persisting the attempt but before POSTing it,
  // submitting the exact same request id safely creates or joins the listener
  // journal. It can never publish a competing payment.
  const submitted = await listenerNwcPayment(bridge, {
    requestId: attempt.requestId,
    walletId,
    paymentHash: attempt.paymentHash,
    invoice: attempt.bolt11,
    idempotencyScope: attempt.proxyPaymentId,
    attemptNo: attempt.attemptNo,
    waitMs: 8000
  })
  if (submitted.ok) {
    await settleAttempt(attempt, submitted.preimage, submitted.feesPaidMsats)
    return 'SUCCEEDED'
  }
  if (submitted.status === 'pending' || submitted.status === 'unknown') {
    await prisma.proxyForwardAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
      data: {
        status: submitted.status === 'pending' ? 'PENDING' : 'UNKNOWN',
        errorCode: submitted.error?.code ?? submitted.status,
        errorMessage: submitted.error?.message ?? null
      }
    })
    if (attempt.expiresAt <= new Date()) {
      return resolveExpiredAttempt(attempt, bridge)
    }
    return 'WAIT'
  }
  if (submitted.status === 'rejected') {
    await prisma.proxyForwardAttempt.updateMany({
      where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
      data: {
        status: 'REJECTED',
        errorCode: submitted.error?.code ?? submitted.status,
        errorMessage: submitted.error?.message ?? null,
        resolvedAt: new Date()
      }
    })
    return 'RETRY'
  }

  // An explicit not_started result proves listener did not dispatch. Before
  // rotating the request id for a later retry, still allow a read-only lookup
  // to recover settlement from a notification/journal race.
  const config = await getProxySettlementConfig()
  if (!config) return 'WAIT'
  try {
    const tx = await listenerNwcRequest<{
      state?: string
      preimage?: string
      fees_paid?: number
    }>(bridge, {
      connectionString: config.connectionString,
      method: 'lookup_invoice',
      params: { payment_hash: attempt.paymentHash }
    })
    if (
      tx.state === 'settled' &&
      tx.preimage &&
      preimageMatchesPaymentHash(tx.preimage, attempt.paymentHash)
    ) {
      await settleAttempt(attempt, tx.preimage, tx.fees_paid ?? 0)
      return 'SUCCEEDED'
    }
    if (tx.state === 'failed') {
      await prisma.proxyForwardAttempt.updateMany({
        where: { id: attempt.id, status: { in: ['PENDING', 'UNKNOWN'] } },
        data: {
          status: 'REJECTED',
          errorCode: 'lookup_failed',
          errorMessage: 'NWC reports the outgoing payment failed',
          resolvedAt: new Date()
        }
      })
      return 'RETRY'
    }
  } catch {
    // Unknown remains unknown; retry only after a later reconciliation proves it.
  }
  return attempt.expiresAt <= new Date() ? 'RETRY' : 'WAIT'
}

async function resolveExpiredAttempt(
  attempt: ProxyForwardAttempt,
  bridge: Awaited<ReturnType<typeof getListenerConfig>>
): Promise<'SUCCEEDED' | 'RETRY' | 'WAIT'> {
  const config = await getProxySettlementConfig()
  if (!config) return 'WAIT'
  try {
    const tx = await listenerNwcRequest<{
      state?: string
      preimage?: string
      fees_paid?: number
    }>(bridge, {
      connectionString: config.connectionString,
      method: 'lookup_invoice',
      params: { payment_hash: attempt.paymentHash }
    })
    if (tx.state === 'settled') {
      if (
        !tx.preimage ||
        !preimageMatchesPaymentHash(tx.preimage, attempt.paymentHash)
      ) {
        // Settlement is reported but cannot yet be proven. Never pay again.
        return 'WAIT'
      }
      await settleAttempt(attempt, tx.preimage, tx.fees_paid ?? 0)
      return 'SUCCEEDED'
    }
    if (tx.state === 'pending') return 'WAIT'
  } catch {
    // Expiry, not an unknown transport result, is what permits a fresh invoice.
  }
  return 'RETRY'
}

async function settleAttempt(
  attempt: Pick<ProxyForwardAttempt, 'id' | 'paymentHash'>,
  preimage: string,
  feesPaidMsats: number
): Promise<void> {
  if (!preimageMatchesPaymentHash(preimage, attempt.paymentHash)) {
    throw new Error('Destination payment preimage does not match payment hash')
  }
  await prisma.proxyForwardAttempt.updateMany({
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

async function finishForwarding(
  payment: PaymentWithAttempts,
  attempt: Pick<
    ProxyForwardAttempt,
    'preimage' | 'routingFeeMsats' | 'amountMsats' | 'paymentHash'
  >,
  workerId: string,
  receiptPrivateKey: string | null
): Promise<boolean> {
  if (
    payment.invoice.status !== 'PAID' ||
    !isDestinationInvoiceAmountAcceptable(
      payment.destinationAmountMsats,
      attempt.amountMsats
    ) ||
    !attempt.preimage ||
    !preimageMatchesPaymentHash(attempt.preimage, attempt.paymentHash)
  ) {
    throw new Error('Proxy completion invariants are not satisfied')
  }
  const forwardedAt = new Date()
  const transitioned = await prisma.proxyPayment.updateMany({
    where: { id: payment.id, leaseOwner: workerId },
    data: {
      status: payment.zapRequest ? 'RECEIPT_PENDING' : 'COMPLETED',
      forwardedAmountMsats: attempt.amountMsats,
      routingFeeMsats: attempt.routingFeeMsats ?? BigInt(0),
      forwardedAt: payment.forwardedAt ?? forwardedAt,
      leaseOwner: payment.zapRequest ? workerId : null,
      leaseExpiresAt: payment.zapRequest
        ? new Date(Date.now() + PROXY_LEASE_MS)
        : null,
      nextRetryAt: new Date(Date.now() + PROXY_RETRY_INTERVAL_MS),
      lastError: null
    }
  })
  if (transitioned.count === 0) return false
  if (!payment.zapRequest) return true
  if (!receiptPrivateKey || !payment.zapRequestJson) {
    throw new Error('Zap receipt signer is not configured')
  }
  const receipt = await publishZapReceipt({
    zapRequest: payment.zapRequest as unknown as Event,
    zapRequestJson: payment.zapRequestJson,
    payerInvoice: payment.invoice.bolt11,
    payerPreimage: payment.sourcePreimage ?? payment.invoice.preimage,
    privateKeyHex: receiptPrivateKey,
    createdAtSeconds: Math.floor(
      (payment.forwardedAt ?? forwardedAt).getTime() / 1000
    )
  })
  const completed = await prisma.proxyPayment.updateMany({
    where: { id: payment.id, leaseOwner: workerId },
    data: {
      status: 'COMPLETED',
      receiptEventId: receipt.event.id,
      receiptPublishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null
    }
  })
  return completed.count > 0
}

async function releaseForRetry(
  id: string,
  workerId: string,
  status: 'PENDING_INBOUND' | 'FORWARDING'
): Promise<void> {
  await prisma.proxyPayment.updateMany({
    where: { id, leaseOwner: workerId },
    data: {
      status,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: new Date(Date.now() + PROXY_RETRY_INTERVAL_MS)
    }
  })
}

async function releaseWithError(
  id: string,
  workerId: string,
  message: string
): Promise<void> {
  await prisma.proxyPayment.updateMany({
    where: { id, leaseOwner: workerId },
    data: {
      status: 'BLOCKED',
      retryCount: { increment: 1 },
      lastError: message.slice(0, 2000),
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: new Date(Date.now() + PROXY_RETRY_INTERVAL_MS)
    }
  })
}

function emitProxyActivityUpdated(): void {
  eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
}
