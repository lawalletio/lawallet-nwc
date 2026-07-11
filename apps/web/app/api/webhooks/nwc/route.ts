import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getListenerConfig } from '@/lib/listener-config'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import {
  NWC_WEBHOOK_MAX_SKEW_MS,
  NWC_WEBHOOK_SIGNATURE_HEADER,
  NWC_WEBHOOK_SIGNATURE_PREFIX,
  NWC_WEBHOOK_TIMESTAMP_HEADER,
  nwcWebhookPayloadSchema,
  type NwcWebhookPayload
} from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import {
  ActivityEvent,
  invoiceLogMetadata,
  logActivity
} from '@/lib/activity-log'
import { logger } from '@/lib/logger'
import { clearPrimaryWalletLinkToWallet } from '@/lib/wallet/primary-wallet'
import { succeedCardPaymentAttempt } from '@/lib/card-payments/lifecycle'

/**
 * Internal machine-to-machine webhook from the NWC listener service
 * (apps/listener). Authenticated by a timestamped HMAC over the raw body —
 * NOT NIP-98/JWT — so it deliberately bypasses `validateBody` (which would
 * consume the body a second time and can't see the raw bytes).
 *
 * Idempotent by design: the listener retries deliveries, so replays of an
 * already-processed event must return 200 without re-applying side effects.
 * Not part of the public OpenAPI spec — the contract lives in
 * `packages/shared/src/listener.ts` and docs/services/NWC-LISTENER.md.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const listener = await getListenerConfig()
  // Integration off (settings toggle or nothing configured) — 404 (a
  // QUIET_CLIENT_ERROR) so a misconfigured listener can't flood the activity
  // log, and the endpoint isn't advertised.
  const webhookSecret = listener.webhookSecret ?? listener.secret
  if (!listener.enabled || !webhookSecret) {
    throw new NotFoundError('Not found')
  }

  const signatureHeader = request.headers.get(NWC_WEBHOOK_SIGNATURE_HEADER)
  const timestampHeader = request.headers.get(NWC_WEBHOOK_TIMESTAMP_HEADER)
  if (!signatureHeader || !timestampHeader) {
    throw new AuthenticationError('Missing webhook signature')
  }

  const timestamp = parseInt(timestampHeader, 10)
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > NWC_WEBHOOK_MAX_SKEW_MS
  ) {
    throw new AuthenticationError('Webhook timestamp outside accepted window')
  }

  const raw = await request.text()
  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestampHeader}.${raw}`)
    .digest('hex')
  const presented = signatureHeader.startsWith(NWC_WEBHOOK_SIGNATURE_PREFIX)
    ? signatureHeader.slice(NWC_WEBHOOK_SIGNATURE_PREFIX.length)
    : signatureHeader
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AuthenticationError('Invalid webhook signature')
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ValidationError('Invalid JSON body')
  }
  const parsed = nwcWebhookPayloadSchema.safeParse(json)
  if (!parsed.success) {
    throw new ValidationError('Invalid request data', parsed.error.errors)
  }
  const event = parsed.data

  switch (event.type) {
    case 'payment_received':
      await handlePaymentReceived(event)
      break
    case 'payment_sent':
      await handlePaymentSent(event)
      break
    case 'listener_error':
      logActivity.fireAndForget({
        category: 'NWC',
        event: ActivityEvent.NWC_LISTENER_ERROR,
        level: 'WARN',
        message: `NWC listener error: ${event.error.message}`,
        metadata: {
          walletId: event.walletId ?? null,
          code: event.error.code,
          error: event.error.message,
          source: 'nwc_listener'
        }
      })
      break
    case 'wallet_dead':
      await archiveDeadWallet(event)
      break
  }

  eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })

  // Object shape (not a bare boolean) so the planned "web returns Nostr
  // events for the listener to publish" extension isn't a breaking change.
  return NextResponse.json({ received: true })
})

type PaymentEvent = Extract<NwcWebhookPayload, { type: 'payment_received' }>
type PaymentSentEvent = Extract<NwcWebhookPayload, { type: 'payment_sent' }>

async function handlePaymentSent(event: PaymentSentEvent): Promise<void> {
  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_PAYMENT_SENT,
    message: `NWC payment sent (${msatsToSats(event.payment.amountMsats)} sats)`,
    metadata: webhookLogMetadata(event)
  })

  const paymentHash = event.payment.paymentHash.toLowerCase()
  const attempt = await prisma.cardPaymentAttempt.findUnique({
    where: {
      walletId_paymentHash: { walletId: event.walletId, paymentHash }
    }
  })
  if (
    !attempt ||
    (attempt.status !== 'PENDING' && attempt.status !== 'UNKNOWN')
  ) {
    return
  }

  // A preimage is cryptographic proof that this exact invoice settled. Some
  // wallets omit it from notifications; those attempts stay UNKNOWN and are
  // resolved by listener journal lookup rather than being guessed successful.
  if (!event.payment.preimage) {
    logger.warn(
      { requestId: attempt.requestId, paymentHash },
      'nwc.payment_sent_missing_preimage'
    )
    return
  }

  try {
    const transitioned = await succeedCardPaymentAttempt(
      attempt,
      {
        preimage: event.payment.preimage,
        feesPaidSats: msatsToSats(event.payment.feesPaidMsats),
        feesPaidMsats: event.payment.feesPaidMsats ?? 0
      },
      attempt.transport
    )
    if (!transitioned) return

    logger.info(
      { requestId: attempt.requestId, paymentHash, walletId: event.walletId },
      'nwc.webhook_card_payment_succeeded'
    )
    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_PAYMENT,
      message: `Card payment of ${attempt.amountMsats / 1000} sats`,
      metadata: {
        cardId: attempt.cardId,
        requestId: attempt.requestId,
        walletId: attempt.walletId,
        amountMsats: attempt.amountMsats,
        amountSats: attempt.amountMsats / 1000,
        status: 'success',
        transport: attempt.transport,
        bolt11: attempt.bolt11,
        paymentHash,
        source: 'nwc_listener'
      }
    })
  } catch (error) {
    // Invalid/mismatched preimages never resolve the row. A later lookup can
    // still provide valid proof without republishing the payment.
    logger.error(
      { err: error, requestId: attempt.requestId, paymentHash },
      'nwc.payment_sent_preimage_mismatch'
    )
  }
}

async function handlePaymentReceived(event: PaymentEvent): Promise<void> {
  const paymentHash = event.payment.paymentHash.toLowerCase()

  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_PAYMENT_RECEIVED,
    message: `NWC payment received (${msatsToSats(event.payment.amountMsats)} sats)`,
    metadata: webhookLogMetadata(event)
  })

  const invoice = await prisma.invoice.findUnique({ where: { paymentHash } })
  // Unknown hash (not one of our minted invoices) or already settled —
  // nothing to apply, still 200 so listener retries are no-ops.
  if (!invoice || invoice.status === 'PAID') return

  const paidAt = event.payment.settledAt
    ? new Date(event.payment.settledAt * 1000)
    : new Date()
  const preimage = event.payment.preimage ?? null

  await prisma.invoice.update({
    where: { paymentHash },
    data: { status: 'PAID', preimage, paidAt }
  })

  logger.info(
    { paymentHash, walletId: event.walletId },
    'nwc.webhook_invoice_paid'
  )
  eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'INVOICE',
    event: ActivityEvent.INVOICE_PAID,
    message: `Invoice paid via NWC listener (${invoice.amountSats} sats)`,
    userId: invoice.userId,
    metadata: {
      ...invoiceLogMetadata({ ...invoice, status: 'PAID', preimage, paidAt }),
      // Which NWC connection (RemoteWallet.id) reported the payment, and
      // whether it arrived via downtime catch-up rather than the live stream.
      remoteWalletId: event.walletId,
      recovered: event.recovered ?? false,
      source: 'nwc_listener'
    }
  })
}

function webhookLogMetadata(
  event: Extract<NwcWebhookPayload, { payment: unknown }>
) {
  return {
    // RemoteWallet.id of the NWC connection that reported the payment.
    remoteWalletId: event.walletId,
    eventKey: event.eventKey,
    paymentHash: event.payment.paymentHash,
    amountMsats: event.payment.amountMsats ?? null,
    feesPaidMsats: event.payment.feesPaidMsats ?? null,
    settledAt: event.payment.settledAt ?? null,
    recovered: event.recovered ?? false,
    source: 'nwc_listener'
  }
}

function msatsToSats(msats: number | undefined): number {
  return Math.floor((msats ?? 0) / 1000)
}

type WalletDeadEvent = Extract<NwcWebhookPayload, { type: 'wallet_dead' }>

/**
 * The listener observed an NWC wallet go unresponsive for a sustained window
 * while its relays stayed connected — the fingerprint of a destroyed
 * disposable LNCurl wallet. Archive it as DEAD, but ONLY when it is still
 * ACTIVE and was provisioned by LNCurl. Any other wallet — a user's own
 * Alby/Mutiny NWC, or an already-retired row — is left untouched: a transient
 * outage must never archive a wallet the user still controls. The provider
 * decision lives here (web owns business logic); the listener only observes.
 *
 * Idempotent: the `status: 'ACTIVE'` predicate makes a replayed webhook a
 * no-op. After the write, the `remote_wallet_changed` trigger drops the wallet
 * from the listener pool, ending the reconnect churn.
 */
async function archiveDeadWallet(event: WalletDeadEvent): Promise<void> {
  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: event.walletId },
    select: { id: true, userId: true, status: true, config: true, name: true }
  })
  if (!wallet || wallet.status !== 'ACTIVE') return

  const provider = (wallet.config as { provider?: unknown } | null)?.provider
  if (provider !== 'lncurl') {
    logger.warn(
      { walletId: wallet.id, provider: provider ?? null },
      'nwc.wallet_dead_ignored_non_lncurl'
    )
    return
  }

  const result = await prisma.$transaction(async tx => {
    const archived = await tx.remoteWallet.updateMany({
      where: { id: wallet.id, status: 'ACTIVE' },
      data: { status: 'DEAD', diedAt: new Date(), isDefault: false }
    })
    if (archived.count > 0) {
      await clearPrimaryWalletLinkToWallet(wallet.userId, wallet.id, tx)
    }
    return archived
  })
  // Lost a race (already transitioned) — replayed webhook is a clean no-op.
  if (result.count === 0) return

  const hours = Math.round(event.unresponsiveSeconds / 3600)
  logger.info({ walletId: wallet.id }, 'nwc.wallet_archived_dead')
  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_WALLET_DEAD,
    level: 'WARN',
    message: `NWC wallet "${wallet.name}" archived as dead (unresponsive ~${hours}h, relays up)`,
    userId: wallet.userId,
    metadata: {
      walletId: wallet.id,
      unresponsiveSeconds: event.unresponsiveSeconds,
      relaysConnected: event.relaysConnected,
      source: 'nwc_listener'
    }
  })
}
