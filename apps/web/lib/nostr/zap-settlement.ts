import { settleInvoiceFromWallet } from '@/lib/invoices/settle-from-wallet'
import { logger } from '@/lib/logger'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'
import { prisma } from '@/lib/prisma'

/**
 * Poll pending zap invoices to settlement so NIP-57 works on every NWC wallet.
 *
 * The listener's `payment_received` notification is the fast path, but
 * `notifications` is OPTIONAL in NIP-47: a wallet is free never to emit one. For
 * those wallets a zap invoice stayed PENDING forever and its kind:9735 receipt
 * was never published, even though the address advertised `allowsNostr` — the
 * zap simply never appeared for the sender or the recipient. This asks the
 * minting wallet directly with `lookup_invoice` instead of waiting to be told.
 *
 * Ordinary (non-zap) LUD-16 invoices are deliberately left out: they already
 * settle through the listener or a LUD-21 verify poll, and sweeping them would
 * scale relay traffic with total receive volume rather than with zap volume.
 */

const SWEEP_BATCH_SIZE = 25

/**
 * How long past expiry an invoice stays pollable. A payment that lands in the
 * last second of the invoice's life still deserves its receipt, and the wallet
 * needs a moment to report it.
 */
const EXPIRY_GRACE_MS = 2 * 60 * 1000

/**
 * Zaps are normally paid within seconds, so poll tightly at first and back off
 * as the odds drop. An unpaid invoice therefore costs a handful of lookups in
 * its first minute, then a trickle until it expires.
 */
export function nextPollDelayMs(attempts: number): number {
  if (attempts < 5) return 15_000
  if (attempts < 12) return 60_000
  return 5 * 60_000
}

/** @returns how many invoices this run moved to PAID. */
export async function settlePendingZapInvoices(): Promise<number> {
  const capability = await getZapReceiptCapability()
  if (!capability.nip57) return 0

  const now = new Date()
  const due = await findDueZapInvoices(now)
  if (due.length === 0) return 0

  const results = await Promise.all(due.map(invoice => pollOne(invoice, now)))
  const settled = results.filter(Boolean).length
  logger.info(
    { candidates: due.length, settled },
    'nip57.zap_settlement_sweep_completed'
  )
  return settled
}

function findDueZapInvoices(now: Date) {
  return prisma.invoice.findMany({
    where: {
      status: 'PENDING',
      zapRequestJson: { not: null },
      // Proxy invoices have their own settlement reconciler, which also owns
      // the forwarding state machine.
      proxyPayment: null,
      // Without the minting wallet there is nothing safe to ask: the address
      // may since have been rebound, and polling a different wallet would be
      // asking about an invoice it never issued. Those rows still settle
      // through the payer's LUD-21 verify poll, which knows the address.
      remoteWalletId: { not: null },
      expiresAt: { gt: new Date(now.getTime() - EXPIRY_GRACE_MS) },
      OR: [
        { settlementNextPollAt: null },
        { settlementNextPollAt: { lte: now } }
      ]
    },
    include: {
      remoteWallet: {
        select: { id: true, type: true, config: true, status: true }
      },
      proxyPayment: { select: { id: true } }
    },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH_SIZE
  })
}

type DueInvoice = Awaited<ReturnType<typeof findDueZapInvoices>>[number]

async function pollOne(invoice: DueInvoice, now: Date): Promise<boolean> {
  // Claim the invoice by pushing its next poll forward. Postgres re-evaluates
  // the predicate after taking the row lock, so of two concurrent sweeps
  // exactly one sees `count === 1` — no separate lease column needed.
  const claimed = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      status: 'PENDING',
      OR: [
        { settlementNextPollAt: null },
        { settlementNextPollAt: { lte: now } }
      ]
    },
    data: {
      settlementNextPollAt: new Date(
        now.getTime() + nextPollDelayMs(invoice.settlementPollAttempts)
      ),
      settlementPollAttempts: { increment: 1 }
    }
  })
  if (claimed.count === 0) return false

  // Awaited rather than deferred: this already runs in the background, and the
  // receipt publish is the whole point of the sweep.
  const settlement = await settleInvoiceFromWallet(invoice, {
    source: 'zap_settlement_sweep'
  })
  return settlement.outcome === 'settled'
}
