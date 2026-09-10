import type {
  InvoiceStatus,
  LightningAddressMode,
  Prisma
} from '@/lib/generated/prisma'
import {
  ActivityEvent,
  invoiceLogMetadata,
  logActivity
} from '@/lib/activity-log'
import { preimageMatchesPaymentHash } from '@/lib/card-payments/lifecycle'
import { eventBus } from '@/lib/events/event-bus'
import { logger } from '@/lib/logger'
import { publishInvoiceZapReceipt } from '@/lib/nostr/zap-receipts'
import { prisma } from '@/lib/prisma'
import { getProxySettlementConfig } from '@/lib/proxy/config'
import { reconcileProxyPayments } from '@/lib/proxy/reconcile'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { LookupInvoiceResult } from '@/lib/wallet/drivers/types'
import {
  resolveWalletRoute,
  type RemoteWalletRef,
  type WalletRoute
} from '@/lib/wallet/resolve-payment-route'

/**
 * Ask the minting wallet whether an invoice settled, and record it if so.
 *
 * Two very different callers need this and must never disagree about it: the
 * payer-driven LUD-21 verify poll, and the NIP-57 settlement sweep that covers
 * wallets which don't implement NIP-47 notifications. The preimage checks below
 * are the reason it lives in one place — a second copy that skipped
 * {@link preimageMatchesPaymentHash} would let a wallet mark a proxy payment
 * forwardable with a preimage that proves nothing.
 */

export type SettlementSource = 'lud21_verify' | 'zap_settlement_sweep'

/**
 * `pending` means the wallet answered "not settled". `unavailable` means we
 * could not get an answer (no route, no lookup support, relay failure) — never
 * conflate them: only `pending` is evidence about the payment.
 */
export type SettlementOutcome = 'settled' | 'pending' | 'unavailable'

/** Carries the preimage so callers don't re-read the row they just settled. */
export type SettlementResult =
  | {
      outcome: Extract<SettlementOutcome, 'settled'>
      preimage: string
      paidAt: Date
    }
  | { outcome: Exclude<SettlementOutcome, 'settled'> }

const SOURCE_LABEL: Record<SettlementSource, string> = {
  lud21_verify: 'LUD-21 verify',
  zap_settlement_sweep: 'zap settlement sweep'
}

/** The address an invoice was minted for, used when the row predates the link. */
export interface SettlementAddress {
  mode: LightningAddressMode
  redirect: string | null
  remoteWallet: RemoteWalletRef | null
}

/** Invoice fields settlement reads. Matches what both call sites already load. */
export interface SettlableInvoice {
  id: string
  bolt11: string
  paymentHash: string
  amountSats: number
  description: string
  purpose: string
  status: InvoiceStatus
  preimage: string | null
  metadata: unknown
  userId: string | null
  expiresAt: Date
  paidAt: Date | null
  createdAt: Date
  zapRequest: Prisma.JsonValue | null
  remoteWallet: RemoteWalletRef | null
  proxyPayment: { id: string } | null
}

export interface SettleFromWalletOptions {
  source: SettlementSource
  /** Fallback route for invoices minted before `remoteWalletId` was persisted. */
  address?: SettlementAddress | null
  /**
   * How to run post-settlement work (zap receipt, proxy reconcile). Request
   * handlers pass `after` so the payer isn't kept waiting; background callers
   * omit it and the work is awaited before returning.
   */
  schedule?: (task: () => Promise<void>) => void
}

/**
 * Which wallet can answer for this invoice.
 *
 * The row's own `remoteWallet` wins: an address rebound to a different wallet
 * must not be asked about an invoice it never minted. Legacy rows without the
 * link fall back to the address's current route.
 */
export function resolveInvoiceWallet(
  invoice: Pick<SettlableInvoice, 'remoteWallet'>,
  address?: SettlementAddress | null
): WalletRoute {
  if (invoice.remoteWallet) {
    return resolveWalletRoute({
      mode: 'CUSTOM_NWC',
      redirect: null,
      remoteWallet: invoice.remoteWallet
    })
  }
  if (address) {
    return resolveWalletRoute({
      mode: address.mode,
      redirect: address.redirect ?? null,
      remoteWallet: address.remoteWallet ?? null
    })
  }
  return { kind: 'unconfigured' }
}

export async function settleInvoiceFromWallet(
  invoice: SettlableInvoice,
  options: SettleFromWalletOptions
): Promise<SettlementResult> {
  const { source } = options
  const deferred: Array<() => Promise<void>> = []
  const schedule =
    options.schedule ??
    ((task: () => Promise<void>) => {
      deferred.push(task)
    })

  let lookup: LookupInvoiceResult
  try {
    // Resolved inside the try so a corrupt vault envelope (rotated
    // NWC_VAULT_SECRET, tampered row) degrades to `unavailable` rather than
    // propagating as an HTTP 500 through the public verify endpoint.
    const wallet = await resolveSettlementWallet(invoice, options.address)
    if (!wallet) return { outcome: 'unavailable' }

    const { driver, config } = wallet
    if (!driver.lookupInvoice) return { outcome: 'unavailable' }
    lookup = await driver.lookupInvoice(config, {
      paymentHash: invoice.paymentHash
    })
  } catch (error) {
    const message = describeError(error)
    logger.warn(
      { paymentHash: invoice.paymentHash, source, error: message },
      'invoice.settlement_lookup_failed'
    )
    const isTimeout = /timeout|timed out|timed-out/i.test(message)
    logActivity.fireAndForget({
      category: 'NWC',
      event: isTimeout
        ? ActivityEvent.NWC_RELAY_TIMEOUT
        : ActivityEvent.NWC_CONNECTION_ERROR,
      level: 'WARN',
      message: isTimeout
        ? 'NWC relay timed out during invoice lookup'
        : 'NWC lookup_invoice failed',
      userId: invoice.userId ?? undefined,
      metadata: { paymentHash: invoice.paymentHash, source, error: message }
    })
    return { outcome: 'unavailable' }
  }

  // A proxy invoice's preimage is about to make the payment forwardable, so it
  // has to actually hash to this payment hash.
  const trustworthy =
    lookup.settled &&
    !!lookup.preimage &&
    (!invoice.proxyPayment ||
      preimageMatchesPaymentHash(lookup.preimage, invoice.paymentHash))
  if (!trustworthy || !lookup.preimage) return { outcome: 'pending' }

  const preimage = lookup.preimage
  const paidAt = new Date(lookup.settledAt ?? Date.now())

  if (invoice.proxyPayment) {
    const proxyPaymentId = invoice.proxyPayment.id
    await prisma.$transaction(async database => {
      await database.invoice.update({
        where: { paymentHash: invoice.paymentHash },
        data: { status: 'PAID', preimage, paidAt }
      })
      await database.proxyPayment.update({
        where: { id: proxyPaymentId },
        data: {
          sourcePaidAt: paidAt,
          sourcePreimage: preimage,
          nextRetryAt: new Date(),
          lastError: null
        }
      })
      await database.proxyPayment.updateMany({
        where: {
          id: proxyPaymentId,
          status: { in: ['PENDING_INBOUND', 'BLOCKED'] }
        },
        data: { status: 'READY_TO_FORWARD' }
      })
    })
    schedule(async () => {
      await reconcileProxyPayments({ ids: [proxyPaymentId] })
    })
  } else {
    // Guarded on PENDING so a listener webhook that won the race keeps its own
    // `paidAt`. Either way the invoice is settled with the same preimage, so a
    // lost race is still a `settled` answer for the caller.
    await prisma.invoice.updateMany({
      where: { paymentHash: invoice.paymentHash, status: 'PENDING' },
      data: { status: 'PAID', preimage, paidAt }
    })
  }

  // Broadcast the PENDING → PAID flip so the owner's invoice feed updates
  // without a manual refresh. Callers only reach here on the transition, so
  // this can't spam the bus on repeated polls of a settled invoice.
  eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'INVOICE',
    event: ActivityEvent.INVOICE_PAID,
    message: `Invoice paid via ${SOURCE_LABEL[source]} (${invoice.amountSats} sats)`,
    userId: invoice.userId ?? undefined,
    metadata: {
      ...invoiceLogMetadata({ ...invoice, status: 'PAID', preimage, paidAt }),
      source
    }
  })
  if (!invoice.proxyPayment && invoice.zapRequest) {
    schedule(() => publishInvoiceZapReceipt(invoice.id).then(() => undefined))
  }

  for (const task of deferred) {
    try {
      await task()
    } catch (error) {
      // Settlement is already durable; follow-up work has its own retries.
      logger.warn(
        { paymentHash: invoice.paymentHash, source, err: error },
        'invoice.settlement_followup_failed'
      )
    }
  }

  return { outcome: 'settled', preimage, paidAt }
}

/** The driver + config that can answer for this invoice, or null. */
async function resolveSettlementWallet(
  invoice: SettlableInvoice,
  address?: SettlementAddress | null
) {
  if (invoice.proxyPayment) {
    // The deferred proxy receives on the instance's own wallet, which is not a
    // RemoteWallet row — hand its URI to the NWC driver directly.
    const proxy = await getProxySettlementConfig()
    if (!proxy?.connectionString) return null
    return driverForWallet({
      type: 'NWC',
      config: { connectionString: proxy.connectionString }
    })
  }

  const route = resolveInvoiceWallet(invoice, address)
  if (route.kind !== 'wallet') return null
  return driverForWallet({
    id: route.walletId ?? undefined,
    type: route.type,
    config: route.config
  })
}

/**
 * Flatten an error and its causes into one string.
 *
 * The driver wraps relay failures in `DriverRemoteError('NWC lookup_invoice
 * failed', { cause })`, so the timeout classification has to look past the
 * outer message or every timeout would be logged as a connection error.
 */
function describeError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    parts.push(current.message)
    current = current.cause
  }
  if (parts.length === 0) parts.push(String(error))
  return parts.join(': ')
}
