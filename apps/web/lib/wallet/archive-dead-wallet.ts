import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { clearPrimaryWalletLinkToWallet } from '@/lib/wallet/primary-wallet'
import {
  WALLET_ARCHIVE_IDLE_MS,
  type NwcWebhookPayload
} from '@/lib/validation/schemas'

export type WalletDeadEvent = Extract<
  NwcWebhookPayload,
  { type: 'wallet_dead' }
>

/**
 * `archived` — the row was flipped to its archived state by this call.
 * `noop` — already archived, or another concurrent call won the race.
 * `ignored` — the report did not meet web's rules (see {@link archiveDeadWallet}).
 * `unknown_wallet` — no RemoteWallet and no proxy config owns this wallet id.
 */
export type ArchiveOutcome = 'archived' | 'noop' | 'ignored' | 'unknown_wallet'

/**
 * Hours of idleness the listener must have observed before web honours an
 * `idle` / `warmup_failed` report. Web re-checks the window itself rather than
 * trusting the listener's threshold config: the 48h rule is product policy and
 * belongs on this side, and a misconfigured `WALLET_ARCHIVE_IDLE_HOURS` must
 * never be able to archive a wallet that went quiet for an afternoon.
 */
export const ARCHIVE_IDLE_MS = WALLET_ARCHIVE_IDLE_MS

/** True when the reported idle window clears the 48h product rule. */
export function meetsIdleArchiveWindow(unresponsiveSeconds: number): boolean {
  return unresponsiveSeconds * 1000 >= ARCHIVE_IDLE_MS
}

/**
 * Applies a listener `wallet_dead` report to web's own state. The listener is
 * transport-only and never writes these rows — every archived wallet is
 * archived here, which is what makes the archive survive a listener restart and
 * show up in the APIs and admin UI.
 *
 * Two report shapes, two rule sets:
 *
 *  - `reason: 'unresponsive'` — a probe-confirmed silent wallet whose relays
 *    stayed up. Only disposable LNCurl wallets are archived on this signal (a
 *    few hours of silence from a user's own Alby/Mutiny node is not death), and
 *    only when `relaysConnected` is true, so a relay outage can't be misread.
 *  - `reason: 'idle' | 'warmup_failed'` — more than 48h with no sign of life at
 *    all. Product rule (issue #279): those are archived regardless of provider,
 *    including wallets that never completed NWC warmup and therefore could
 *    never produce any other signal. Recoverable: the owner can PATCH the
 *    wallet back to ACTIVE.
 *
 * Idempotent — a replayed webhook finds the row already archived and no-ops.
 * After the write, the `remote_wallet_changed` trigger drops the wallet from the
 * listener pool, which is what finally ends the reconnect churn.
 */
export async function archiveDeadWallet(
  event: WalletDeadEvent
): Promise<ArchiveOutcome> {
  const reason = event.reason
  if (reason === 'unresponsive' && !event.relaysConnected) {
    // Probe-confirmed death is only meaningful with the relays up.
    logger.warn(
      { walletId: event.walletId },
      'nwc.wallet_dead_ignored_relays_down'
    )
    return 'ignored'
  }
  if (
    reason !== 'unresponsive' &&
    !meetsIdleArchiveWindow(event.unresponsiveSeconds)
  ) {
    logger.warn(
      {
        walletId: event.walletId,
        reason,
        unresponsiveSeconds: event.unresponsiveSeconds
      },
      'nwc.wallet_dead_ignored_below_idle_window'
    )
    return 'ignored'
  }

  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: event.walletId },
    select: { id: true, userId: true, status: true, config: true, name: true }
  })
  if (wallet) return archiveRemoteWallet(event, wallet)
  return archiveProxyWallet(event)
}

async function archiveRemoteWallet(
  event: WalletDeadEvent,
  wallet: {
    id: string
    userId: string
    status: string
    config: unknown
    name: string
  }
): Promise<ArchiveOutcome> {
  if (wallet.status !== 'ACTIVE') return 'noop'

  const provider = (wallet.config as { provider?: unknown } | null)?.provider
  // Probe-confirmed death only archives the disposable wallets we minted; the
  // 48h idle rule applies to every wallet (product lock, issue #279).
  if (event.reason === 'unresponsive' && provider !== 'lncurl') {
    logger.warn(
      { walletId: wallet.id, provider: provider ?? null },
      'nwc.wallet_dead_ignored_non_lncurl'
    )
    return 'ignored'
  }

  const diedAt = new Date()
  const result = await prisma.$transaction(async tx => {
    const archived = await tx.remoteWallet.updateMany({
      where: { id: wallet.id, status: 'ACTIVE' },
      data: {
        status: 'DEAD',
        diedAt,
        diedReason: event.reason,
        isDefault: false
      }
    })
    if (archived.count > 0) {
      await clearPrimaryWalletLinkToWallet(wallet.userId, wallet.id, tx)
    }
    return archived
  })
  // Lost a race (already transitioned) — replayed webhook is a clean no-op.
  if (result.count === 0) return 'noop'

  logger.info(
    { walletId: wallet.id, reason: event.reason },
    'nwc.wallet_archived_dead'
  )
  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_WALLET_DEAD,
    level: 'WARN',
    message: `NWC wallet "${wallet.name}" archived — ${describeReason(event)}`,
    userId: wallet.userId,
    metadata: {
      walletId: wallet.id,
      reason: event.reason,
      unresponsiveSeconds: event.unresponsiveSeconds,
      relaysConnected: event.relaysConnected,
      lastState: event.lastState ?? null,
      everReady: event.everReady ?? null,
      source: 'nwc_listener'
    }
  })
  return 'archived'
}

/**
 * The LUD-16 proxy's NWC wallet lives in `ProxyServiceConfig`, not
 * `RemoteWallet` — its `walletId` is a separate identifier (the
 * `__lawallet_proxy__` default or an operator-set UUID). Archiving it stops new
 * proxy intake while leaving outstanding settlements to finish: those read the
 * stored credential regardless of `enabled`.
 */
async function archiveProxyWallet(
  event: WalletDeadEvent
): Promise<ArchiveOutcome> {
  const config = await prisma.proxyServiceConfig.findFirst({
    where: { walletId: event.walletId },
    select: { id: true, archivedAt: true, lastListenerSeenAt: true }
  })
  if (!config) {
    logger.warn(
      { walletId: event.walletId },
      'nwc.wallet_dead_unknown_wallet_id'
    )
    return 'unknown_wallet'
  }
  if (config.archivedAt) return 'noop'

  // Web's own record of the wallet answering. A payment webhook inside the idle
  // window contradicts the report, so refuse rather than disable a working
  // proxy on a stale observation.
  const seenAt = config.lastListenerSeenAt
  if (seenAt && Date.now() - seenAt.getTime() < ARCHIVE_IDLE_MS) {
    logger.warn(
      { walletId: event.walletId, lastListenerSeenAt: seenAt.toISOString() },
      'nwc.proxy_wallet_dead_contradicted_by_recent_activity'
    )
    return 'ignored'
  }

  const archivedAt = new Date()
  const result = await prisma.proxyServiceConfig.updateMany({
    where: { id: config.id, archivedAt: null },
    data: { archivedAt, archivedReason: event.reason, enabled: false }
  })
  if (result.count === 0) return 'noop'

  logger.warn(
    { walletId: event.walletId, reason: event.reason },
    'nwc.proxy_wallet_archived_dead'
  )
  eventBus.emit({ type: 'settings:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_WALLET_DEAD,
    level: 'WARN',
    message: `LUD-16 proxy wallet archived — ${describeReason(event)}`,
    metadata: {
      walletId: event.walletId,
      proxyConfigId: config.id,
      reason: event.reason,
      unresponsiveSeconds: event.unresponsiveSeconds,
      relaysConnected: event.relaysConnected,
      lastState: event.lastState ?? null,
      everReady: event.everReady ?? null,
      source: 'nwc_listener'
    }
  })
  return 'archived'
}

function describeReason(event: WalletDeadEvent): string {
  const hours = Math.round(event.unresponsiveSeconds / 3600)
  switch (event.reason) {
    case 'warmup_failed':
      return `NWC warm-up never succeeded and it has been idle ~${hours}h`
    case 'idle':
      return `no sign of life for ~${hours}h`
    default:
      return `unresponsive ~${hours}h with relays up`
  }
}
