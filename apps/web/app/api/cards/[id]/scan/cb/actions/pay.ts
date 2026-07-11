import { NextRequest, NextResponse } from 'next/server'
import type {
  CardPaymentAttempt,
  CardPaymentTransport,
  RemoteWalletType
} from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import type { LUD03CallbackError, LUD03CallbackSuccess } from '@/types/lnurl'
import { logger } from '@/lib/logger'
import { payActionQuerySchema } from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'
import {
  ExpiredCardPaymentInvoiceError,
  parseCardPaymentInvoice
} from '@/lib/invoice-utils'
import {
  claimCardPaymentAttempt,
  type ClaimCardPaymentAttemptResult
} from '@/lib/card-payments/attempts'
import {
  markCardPaymentUnknown,
  preimageMatchesPaymentHash,
  rejectCardPaymentAttempt,
  succeedCardPaymentAttempt,
  switchCardPaymentAttemptToDirect
} from '@/lib/card-payments/lifecycle'
import {
  resolveCardWallet,
  type RemoteWalletRef
} from '@/lib/wallet/resolve-payment-route'
import {
  driverForWallet,
  getInFlightDirectPayment,
  PaymentOutcomeUnknownError,
  PaymentRejectedError,
  reconcileDirectNwcPayment,
  type PayInvoiceResult
} from '@/lib/wallet/drivers'
import {
  getListenerNwcPayment,
  listenerNwcPayment,
  prepareListenerPaymentFastPath,
  resolveListenerBridge
} from '@/lib/wallet/drivers/listener-transport'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { eventBus } from '@/lib/events/event-bus'

type StoredWallet = Required<Pick<RemoteWalletRef, 'id'>> & RemoteWalletRef

export interface CardPaymentActionCard {
  id: string
  ntag424Cid: string | null
  remoteWallet: StoredWallet | null
  user: {
    lightningAddresses: Array<{ remoteWallet: StoredWallet | null }>
  } | null
}

const LISTENER_WAIT_MS = 8000
const backgroundReconciliations = new Map<string, Promise<void>>()

/**
 * Irrevocable BoltCard spend path. The database attempt is the source of
 * truth: only a newly-created row may publish, while retries can only join or
 * reconcile that same operation.
 */
export default async function pay(
  req: NextRequest,
  card: CardPaymentActionCard,
  counter: number
): Promise<NextResponse> {
  const { pr } = validateQuery(req.url, payActionQuerySchema)
  let invoice: ReturnType<typeof parseCardPaymentInvoice>
  try {
    invoice = parseCardPaymentInvoice(pr)
  } catch (error) {
    if (error instanceof ExpiredCardPaymentInvoiceError) {
      const existing = await findExactAttempt(card.id, counter, error.invoice)
      if (existing) return resumeAttempt(existing)
    }
    return ludError(
      error instanceof Error ? error.message : 'Invalid Lightning invoice'
    )
  }

  if (!card.ntag424Cid) return ludError('Card is not paired')

  const defaultWallet = card.user?.lightningAddresses[0]?.remoteWallet ?? null
  const route = resolveCardWallet({
    remoteWallet: card.remoteWallet,
    defaultRemoteWallet: defaultWallet
  })

  // An exact retry must remain recoverable even if the operator changed or
  // disabled the wallet after the original dispatch.
  if (route.kind !== 'wallet' || !route.walletId) {
    const existing = await findExactAttempt(card.id, counter, invoice)
    return existing
      ? resumeAttempt(existing)
      : ludError('Card is not configured for payments')
  }

  let resolved: ReturnType<typeof driverForWallet>
  try {
    resolved = driverForWallet({ type: route.type, config: route.config })
  } catch (error) {
    logger.error(
      { err: error, cardId: card.id },
      'Card wallet configuration is invalid'
    )
    const existing = await findExactAttempt(card.id, counter, invoice)
    return existing
      ? resumeAttempt(existing)
      : ludError('Card wallet configuration is invalid')
  }
  if (
    route.type === 'NWC' &&
    (resolved.config as { mode?: string }).mode !== 'SEND_RECEIVE'
  ) {
    const existing = await findExactAttempt(card.id, counter, invoice)
    return existing
      ? resumeAttempt(existing)
      : ludError('Card wallet is not enabled for outgoing payments')
  }

  const listener = await resolveListenerBridge()
  const listenerReady =
    route.type === 'NWC' && listener.enabled
      ? await prepareListenerPaymentFastPath(listener, route.walletId)
      : false
  const selectedTransport: CardPaymentTransport =
    listenerReady ? 'LISTENER' : 'DIRECT'

  // The one-time listener capability probe can consume part of a very short
  // invoice's remaining life. Recheck the already-decoded timestamp before
  // atomically consuming the tap.
  if (invoice.expiresAt <= Date.now()) {
    const existing = await findExactAttempt(card.id, counter, invoice)
    return existing
      ? resumeAttempt(existing)
      : ludError('Lightning invoice has expired')
  }

  const claim = await claimCardPaymentAttempt({
    cardId: card.id,
    ntag424Cid: card.ntag424Cid,
    counter,
    walletId: route.walletId,
    paymentHash: invoice.paymentHash,
    bolt11: invoice.bolt11,
    amountMsats: invoice.amountMsats,
    transport: selectedTransport
  })

  if (claim.outcome === 'EXISTING') return resumeAttempt(claim.attempt)
  if (claim.outcome !== 'CREATED') return claimError(claim)

  logger.info(
    {
      cardId: card.id,
      walletId: route.walletId,
      requestId: claim.attempt.requestId,
      transport: selectedTransport
    },
    'Card payment claimed'
  )

  try {
    const result = await resolved.driver.payInvoice(
      resolved.config,
      { bolt11: invoice.bolt11 },
      {
        walletId: route.walletId,
        requestId: claim.attempt.requestId,
        paymentHash: invoice.paymentHash,
        deadlineMs: LISTENER_WAIT_MS,
        transport: selectedTransport,
        listenerBridge: listener,
        beforeDirectFallback: () =>
          switchCardPaymentAttemptToDirect(claim.attempt.id)
      }
    )
    return handleSuccess(claim.attempt, result, route.type)
  } catch (error) {
    return handleDispatchError(claim.attempt, error, route.type)
  }
}

async function claimError(
  claim: Exclude<
    ClaimCardPaymentAttemptResult,
    { outcome: 'CREATED' | 'EXISTING' }
  >
): Promise<NextResponse> {
  switch (claim.outcome) {
    case 'BUSY':
      reconcileInBackground(claim.attempt)
      return ludError('A previous card payment is still being resolved', true)
    case 'REPLAY':
      return ludError('Card tap was already used for a different payment')
    case 'CONFLICT':
      return ludError('Payment was already claimed by another card tap')
    case 'STALE_COUNTER':
      return ludError('Card tap counter is stale')
    case 'CARD_NOT_FOUND':
      return ludError('Card is not paired')
  }
}

function reconcileInBackground(attempt: CardPaymentAttempt): void {
  if (backgroundReconciliations.has(attempt.requestId)) return
  const reconciliation = resumeAttempt(attempt)
    .then(() => undefined)
    .catch(error => {
      logger.warn(
        { err: error, requestId: attempt.requestId },
        'Background card payment reconciliation failed'
      )
    })
    .finally(() => {
      if (backgroundReconciliations.get(attempt.requestId) === reconciliation) {
        backgroundReconciliations.delete(attempt.requestId)
      }
    })
  backgroundReconciliations.set(attempt.requestId, reconciliation)
}

async function resumeAttempt(
  attempt: CardPaymentAttempt
): Promise<NextResponse> {
  if (attempt.status === 'SUCCEEDED') return ludSuccess()
  if (attempt.status === 'REJECTED')
    return ludError('Payment was rejected by the wallet')

  if (attempt.transport === 'LISTENER') {
    const bridge = await resolveListenerBridge()
    let result = await getListenerNwcPayment(bridge, attempt.requestId)

    // The process can stop after the web attempt is committed but before its
    // first listener POST. GET then has no journal row to return. Re-submit
    // the identical operation so listener can either create it or join its
    // durable requestId single-flight; this must never switch to DIRECT.
    if (
      !result ||
      (!result.ok &&
        (result.status === 'pending' || result.status === 'unknown'))
    ) {
      try {
        result = await listenerNwcPayment(bridge, {
          requestId: attempt.requestId,
          walletId: attempt.walletId,
          invoice: attempt.bolt11,
          paymentHash: attempt.paymentHash,
          waitMs: LISTENER_WAIT_MS
        })
      } catch (error) {
        logger.warn(
          { err: error, requestId: attempt.requestId },
          'Listener card payment retry remains unresolved'
        )
        const transitioned = await markCardPaymentUnknown(
          attempt.id,
          'LISTENER_PAYMENT_PENDING',
          'LISTENER'
        )
        return transitioned
          ? ludError('Payment outcome is still being resolved', true)
          : responseFromCurrentAttempt(attempt.id)
      }
    }

    if (result.ok) {
      return handleSuccess(
        attempt,
        {
          preimage: result.preimage,
          feesPaidSats: Math.floor(result.feesPaidMsats / 1000),
          feesPaidMsats: result.feesPaidMsats,
          transport: 'LISTENER'
        },
        'NWC'
      )
    }
    if (result.status === 'rejected') {
      const transitioned = await rejectCardPaymentAttempt(
        attempt.id,
        stableErrorCode(result.error?.walletErrorCode ?? result.error?.code),
        'LISTENER'
      )
      if (transitioned) recordFailure(attempt, 'NWC', result.error?.message)
      return transitioned
        ? ludError('Payment was rejected by the wallet')
        : responseFromCurrentAttempt(attempt.id)
    }
    const transitioned = await markCardPaymentUnknown(
      attempt.id,
      stableErrorCode(result.error?.code ?? 'LISTENER_PAYMENT_PENDING'),
      'LISTENER'
    )
    // `not_started` is only safe for the first foreground POST. Once an
    // attempt has been pinned to LISTENER, a missing journal can never cause a
    // second transport to publish the invoice.
    return transitioned
      ? ludError('Payment outcome is still being resolved', true)
      : responseFromCurrentAttempt(attempt.id)
  }

  const inFlight = getInFlightDirectPayment(attempt.requestId)
  if (inFlight) {
    try {
      return handleSuccess(attempt, await inFlight, 'NWC')
    } catch (error) {
      return handleDispatchError(attempt, error, 'NWC')
    }
  }

  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: attempt.walletId },
    select: { type: true, config: true }
  })
  if (!wallet || wallet.type !== 'NWC') {
    return ludError('Payment outcome is still being resolved', true)
  }

  try {
    const { config } = driverForWallet(wallet)
    const result = await reconcileDirectNwcPayment(
      (config as { connectionString: string }).connectionString,
      attempt.paymentHash
    )
    if (result === 'rejected') {
      const transitioned = await rejectCardPaymentAttempt(
        attempt.id,
        'LOOKUP_REJECTED',
        'DIRECT'
      )
      if (transitioned)
        recordFailure(attempt, wallet.type, 'Wallet lookup rejected payment')
      return transitioned
        ? ludError('Payment was rejected by the wallet')
        : responseFromCurrentAttempt(attempt.id)
    }
    if (result) return handleSuccess(attempt, result, wallet.type)
  } catch (error) {
    logger.warn(
      { err: error, requestId: attempt.requestId },
      'Direct card payment reconciliation failed'
    )
  }
  return ludError('Payment outcome is still being resolved', true)
}

async function handleSuccess(
  attempt: CardPaymentAttempt,
  result: PayInvoiceResult,
  walletType: RemoteWalletType
): Promise<NextResponse> {
  if (!preimageMatchesPaymentHash(result.preimage, attempt.paymentHash)) {
    logger.error(
      { requestId: attempt.requestId },
      'Card payment returned an invalid preimage'
    )
    await markCardPaymentUnknown(
      attempt.id,
      'PREIMAGE_HASH_MISMATCH',
      result.transport ?? attempt.transport
    )
    return ludError('Payment outcome is still being resolved', true)
  }

  try {
    const transitioned = await succeedCardPaymentAttempt(
      attempt,
      result,
      attempt.transport
    )
    if (transitioned) {
      recordSuccess(attempt, walletType, result.transport ?? attempt.transport)
    }
    return transitioned ? ludSuccess() : responseFromCurrentAttempt(attempt.id)
  } catch (error) {
    logger.error(
      { err: error, requestId: attempt.requestId },
      'Card payment result could not be persisted'
    )
    await markCardPaymentUnknown(
      attempt.id,
      'PAYMENT_PERSISTENCE_ERROR',
      result.transport ?? attempt.transport
    ).catch(() => false)
    return ludError('Payment outcome is still being resolved', true)
  }
}

async function handleDispatchError(
  attempt: CardPaymentAttempt,
  error: unknown,
  walletType: RemoteWalletType
): Promise<NextResponse> {
  if (error instanceof PaymentRejectedError) {
    const transitioned = await rejectCardPaymentAttempt(
      attempt.id,
      stableErrorCode(error.code ?? 'WALLET_REJECTED'),
      error.transport ?? attempt.transport
    )
    if (transitioned) {
      recordFailure(
        attempt,
        walletType,
        error.message,
        error.transport ?? attempt.transport
      )
    }
    return transitioned
      ? ludError('Payment was rejected by the wallet')
      : responseFromCurrentAttempt(attempt.id)
  }

  const transport =
    error instanceof PaymentOutcomeUnknownError
      ? error.transport
      : attempt.transport
  const transitioned = await markCardPaymentUnknown(
    attempt.id,
    error instanceof PaymentOutcomeUnknownError
      ? 'PAYMENT_OUTCOME_UNKNOWN'
      : 'PAYMENT_DISPATCH_ERROR',
    transport
  )
  logger.error(
    { err: error, requestId: attempt.requestId, transport },
    'Card payment outcome is unknown'
  )
  return transitioned
    ? ludError('Payment outcome is still being resolved', true)
    : responseFromCurrentAttempt(attempt.id)
}

async function responseFromCurrentAttempt(
  attemptId: string
): Promise<NextResponse> {
  const current = await prisma.cardPaymentAttempt.findUnique({
    where: { id: attemptId },
    select: { status: true }
  })
  if (current?.status === 'SUCCEEDED') return ludSuccess()
  if (current?.status === 'REJECTED') {
    return ludError('Payment was rejected by the wallet')
  }
  return ludError('Payment outcome is still being resolved', true)
}

async function findExactAttempt(
  cardId: string,
  counter: number,
  invoice: ReturnType<typeof parseCardPaymentInvoice>
): Promise<CardPaymentAttempt | null> {
  const attempt = await prisma.cardPaymentAttempt.findUnique({
    where: { cardId_counter: { cardId, counter } }
  })
  return attempt &&
    attempt.paymentHash.toLowerCase() === invoice.paymentHash &&
    attempt.bolt11 === invoice.bolt11 &&
    attempt.amountMsats === invoice.amountMsats
    ? attempt
    : null
}

function recordSuccess(
  attempt: CardPaymentAttempt,
  walletType: RemoteWalletType,
  transport: CardPaymentTransport = attempt.transport
): void {
  logActivity.fireAndForget({
    category: 'CARD',
    event: ActivityEvent.CARD_PAYMENT,
    message: `Card payment of ${attempt.amountMsats / 1000} sats`,
    metadata: activityMetadata(attempt, walletType, 'success', transport)
  })
  eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
}

function recordFailure(
  attempt: CardPaymentAttempt,
  walletType: RemoteWalletType,
  error?: string,
  transport: CardPaymentTransport = attempt.transport
): void {
  logActivity.fireAndForget({
    category: 'CARD',
    event: ActivityEvent.CARD_PAYMENT,
    level: 'ERROR',
    message: `Card payment failed (${attempt.amountMsats / 1000} sats)`,
    metadata: {
      ...activityMetadata(attempt, walletType, 'failed', transport),
      error: error ?? 'Wallet rejected payment'
    }
  })
  eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
}

function activityMetadata(
  attempt: CardPaymentAttempt,
  walletType: RemoteWalletType,
  status: 'success' | 'failed',
  transport: CardPaymentTransport
): Record<string, unknown> {
  return {
    cardId: attempt.cardId,
    requestId: attempt.requestId,
    amountSats: attempt.amountMsats / 1000,
    amountMsats: attempt.amountMsats,
    status,
    walletType,
    walletId: attempt.walletId,
    transport,
    bolt11: attempt.bolt11,
    paymentHash: attempt.paymentHash
  }
}

function stableErrorCode(value: string | undefined): string {
  const normalized = (value ?? 'WALLET_REJECTED')
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, '_')
  return normalized.slice(0, 120) || 'WALLET_REJECTED'
}

function ludSuccess(): NextResponse {
  return NextResponse.json({ status: 'OK' } satisfies LUD03CallbackSuccess, {
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}

function ludError(reason: string, retry = false): NextResponse {
  return NextResponse.json(
    { status: 'ERROR', reason } satisfies LUD03CallbackError,
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        ...(retry ? { 'Retry-After': '1' } : {})
      }
    }
  )
}
