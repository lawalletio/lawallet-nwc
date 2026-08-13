import { createHash } from 'node:crypto'
import { errorMessage } from '@/lib/error-message'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { PROXY_RETRY_INTERVAL_MS as SWEEP_INTERVAL_MS } from '@/lib/proxy/constants'
import {
  listenerNwcRequest,
  ListenerUnavailableError,
  resolveListenerBridge
} from '@/lib/wallet/drivers/listener-transport'
import { getServerNwcClient } from '@/lib/wallet/drivers/nwc-client-cache'
import { decryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'
import { captureForwardingReceipt } from './service'

/**
 * How far back the very first sweep of a wallet may reach. A payment older
 * than this was never going to be forwarded and the source balance has most
 * likely been spent, so importing it would only mint BLOCKED receipts.
 *
 * ponytail: fixed ceiling, no per-wallet override. Make it configurable only
 * if an operator actually needs to recover a longer outage.
 */
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Re-scan window overlap. `settled_at` comes from the source wallet's clock,
 * so a payment can surface just behind the previous cursor.
 */
const OVERLAP_MS = 60 * 60 * 1000

/** One page is plenty at a 10-minute cadence; the cursor picks up the rest. */
const PAGE_LIMIT = 50

/**
 * Wallets swept per invocation. This runs inside `after()` behind the webhook,
 * so an unbounded serial loop would stretch a request's tail by one relay
 * round-trip per wallet. Oldest cursor first, so the rest catch up next tick.
 *
 * ponytail: serial and capped. Batch concurrently only if sweep latency ever
 * shows up in listener tick timings.
 */
const MAX_ACTIONS_PER_SWEEP = 25

interface RawIncomingTransaction {
  type?: string
  amount?: number
  payment_hash?: string
  invoice?: string
  settled_at?: number | null
}

/**
 * A `RemoteWalletForwardReceipt` is otherwise only ever created by the
 * listener's `payment_received` webhook. When that delivery is lost — web
 * rejecting it while the bridge is misconfigured, the wallet never entering
 * the listener pool, or an outage outside the listener's own catch-up window —
 * the listener's dedup key guarantees it is never resent, and the payment sits
 * in the UI as "Awaiting forwarding" forever with nothing able to claim it.
 *
 * So ask the wallet itself. Rows are captured through the same
 * {@link captureForwardingReceipt} used by the webhook, with the same derived
 * `eventKey`, so a race with a live delivery collides on the unique index and
 * resolves to a single receipt.
 *
 * @returns how many receipts were recovered.
 */
export async function sweepMissedPayments(
  options: { walletIds?: string[]; force?: boolean } = {}
): Promise<number> {
  const walletIds = [
    ...new Set((options.walletIds ?? []).filter(id => id.length > 0))
  ]
  const due = new Date(Date.now() - SWEEP_INTERVAL_MS)
  const actions = await prisma.remoteWalletReceiveAction.findMany({
    where: {
      enabled: true,
      enabledAt: { not: null },
      remoteWallet: { status: 'ACTIVE', type: 'NWC' },
      ...(walletIds.length > 0 ? { remoteWalletId: { in: walletIds } } : {}),
      ...(options.force
        ? {}
        : { OR: [{ lastSweepAt: null }, { lastSweepAt: { lte: due } }] })
    },
    select: {
      id: true,
      remoteWalletId: true,
      enabledAt: true,
      lastSweepAt: true,
      remoteWallet: { select: { id: true, type: true, config: true } }
    },
    orderBy: { lastSweepAt: { sort: 'asc', nulls: 'first' } },
    take: MAX_ACTIONS_PER_SWEEP
  })

  let recovered = 0
  for (const action of actions) {
    try {
      recovered += await sweepAction(action)
    } catch (error) {
      // A wallet that can't be swept must not stall the others, and the
      // reconciler behind us still has real work to do.
      logger.warn(
        {
          err: error,
          remoteWalletId: action.remoteWalletId,
          reason: errorMessage(error, 'Sweep failed')
        },
        'remote_wallet_forwarding.capture_sweep_failed'
      )
    }
  }
  return recovered
}

type SweepableAction = {
  id: string
  remoteWalletId: string
  enabledAt: Date | null
  lastSweepAt: Date | null
  remoteWallet: { id: string; type: string; config: unknown }
}

async function sweepAction(action: SweepableAction): Promise<number> {
  const now = Date.now()
  const floor = Math.max(
    action.enabledAt?.getTime() ?? 0,
    action.lastSweepAt ? action.lastSweepAt.getTime() - OVERLAP_MS : 0,
    now - MAX_LOOKBACK_MS
  )
  const { connectionString } = decryptRemoteWalletConfig(
    action.remoteWallet.id,
    'NWC',
    action.remoteWallet.config
  ) as { connectionString: string }

  const transactions = await listIncoming(connectionString, {
    from: Math.floor(floor / 1000),
    until: Math.ceil(now / 1000)
  })

  let recovered = 0
  for (const transaction of transactions) {
    if (transaction.type !== 'incoming') continue
    if (!transaction.settled_at) continue
    const paymentHash = transaction.payment_hash
    if (!paymentHash || !/^[0-9a-f]{64}$/i.test(paymentHash)) continue
    const receiptId = await captureForwardingReceipt({
      eventKey: eventKeyFor(action.remoteWalletId, paymentHash),
      walletId: action.remoteWalletId,
      receivedAt: now,
      recovered: true,
      payment: {
        paymentHash,
        amountMsats: transaction.amount,
        settledAt: transaction.settled_at,
        invoice: transaction.invoice
      }
    })
    if (receiptId) recovered++
  }

  // Stamp the cursor even on a clean sweep — the throttle is what keeps this
  // to one `list_transactions` per wallet per interval.
  await prisma.remoteWalletReceiveAction.update({
    where: { id: action.id },
    data: { lastSweepAt: new Date(now) }
  })

  if (recovered > 0) {
    logger.warn(
      {
        remoteWalletId: action.remoteWalletId,
        scanned: transactions.length,
        recovered
      },
      'remote_wallet_forwarding.capture_sweep_recovered'
    )
  }
  return recovered
}

/**
 * Listener first, direct relay as fallback — the same shape as
 * `nwcDriver.getBalance`. The fallback carries the weight here: when the
 * broken link *is* the listener bridge, this is the only way web ever learns
 * about the payment it owes.
 */
async function listIncoming(
  connectionString: string,
  window: { from: number; until: number }
): Promise<RawIncomingTransaction[]> {
  const params = {
    from: window.from,
    until: window.until,
    limit: PAGE_LIMIT,
    type: 'incoming',
    unpaid: false
  }
  const bridge = await resolveListenerBridge()
  if (bridge.enabled) {
    try {
      const res = await listenerNwcRequest<{
        transactions?: RawIncomingTransaction[]
      }>(bridge, {
        connectionString,
        method: 'list_transactions',
        params
      })
      return res.transactions ?? []
    } catch (err) {
      if (!(err instanceof ListenerUnavailableError)) throw err
      logger.warn(
        { err },
        'remote_wallet_forwarding.capture_sweep_listener_unavailable'
      )
    }
  }
  const client = await getServerNwcClient(connectionString)
  const res = (await client.listTransactions(
    params as Parameters<typeof client.listTransactions>[0]
  )) as { transactions?: RawIncomingTransaction[] }
  return res.transactions ?? []
}

/**
 * Mirrors `computeEventKey` in apps/listener/src/store.ts. Identical inputs
 * are what makes a swept capture idempotent against the live webhook.
 */
function eventKeyFor(walletId: string, paymentHash: string): string {
  return createHash('sha256')
    .update(`${walletId}|payment_received|${paymentHash}`)
    .digest('hex')
}
