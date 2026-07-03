import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import {
  NWC_WEBHOOK_MAX_SKEW_MS,
  NWC_WEBHOOK_SIGNATURE_HEADER,
  NWC_WEBHOOK_SIGNATURE_PREFIX,
  NWC_WEBHOOK_TIMESTAMP_HEADER,
  nwcWebhookPayloadSchema,
  type NwcWebhookPayload,
} from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, invoiceLogMetadata, logActivity } from '@/lib/activity-log'
import { logger } from '@/lib/logger'

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
  const { listener } = getConfig()
  // Feature off — 404 (a QUIET_CLIENT_ERROR) so a misconfigured listener
  // can't flood the activity log, and the endpoint isn't advertised.
  if (!listener.webhookEnabled || !listener.secret) {
    throw new NotFoundError('Not found')
  }

  const signatureHeader = request.headers.get(NWC_WEBHOOK_SIGNATURE_HEADER)
  const timestampHeader = request.headers.get(NWC_WEBHOOK_TIMESTAMP_HEADER)
  if (!signatureHeader || !timestampHeader) {
    throw new AuthenticationError('Missing webhook signature')
  }

  const timestamp = parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > NWC_WEBHOOK_MAX_SKEW_MS) {
    throw new AuthenticationError('Webhook timestamp outside accepted window')
  }

  const raw = await request.text()
  const expected = createHmac('sha256', listener.secret)
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
      logActivity.fireAndForget({
        category: 'NWC',
        event: ActivityEvent.NWC_PAYMENT_SENT,
        message: `NWC payment sent (${msatsToSats(event.payment.amountMsats)} sats)`,
        metadata: webhookLogMetadata(event),
      })
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
          source: 'nwc_listener',
        },
      })
      break
  }

  eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })

  // Object shape (not a bare boolean) so the planned "web returns Nostr
  // events for the listener to publish" extension isn't a breaking change.
  return NextResponse.json({ received: true })
})

type PaymentEvent = Extract<NwcWebhookPayload, { type: 'payment_received' }>

async function handlePaymentReceived(event: PaymentEvent): Promise<void> {
  const paymentHash = event.payment.paymentHash.toLowerCase()

  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_PAYMENT_RECEIVED,
    message: `NWC payment received (${msatsToSats(event.payment.amountMsats)} sats)`,
    metadata: webhookLogMetadata(event),
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
    data: { status: 'PAID', preimage, paidAt },
  })

  logger.info({ paymentHash, walletId: event.walletId }, 'nwc.webhook_invoice_paid')
  eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'INVOICE',
    event: ActivityEvent.INVOICE_PAID,
    message: `Invoice paid via NWC listener (${invoice.amountSats} sats)`,
    userId: invoice.userId,
    metadata: {
      ...invoiceLogMetadata({ ...invoice, status: 'PAID', preimage, paidAt }),
      source: 'nwc_listener',
    },
  })
}

function webhookLogMetadata(
  event: Extract<NwcWebhookPayload, { payment: unknown }>
) {
  return {
    walletId: event.walletId,
    eventKey: event.eventKey,
    paymentHash: event.payment.paymentHash,
    amountMsats: event.payment.amountMsats ?? null,
    feesPaidMsats: event.payment.feesPaidMsats ?? null,
    settledAt: event.payment.settledAt ?? null,
    source: 'nwc_listener',
  }
}

function msatsToSats(msats: number | undefined): number {
  return Math.floor((msats ?? 0) / 1000)
}
