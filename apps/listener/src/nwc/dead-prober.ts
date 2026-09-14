import { Nip47Error, Nip47TimeoutError } from '@getalby/sdk'
import type { NWCClient } from '@getalby/sdk'
import type pg from 'pg'
import type { Logger } from 'pino'
import type { NwcWalletDeadReason } from '@lawallet-nwc/shared'
import type { ListenerEnv } from '../env'
import type { Metrics } from '../metrics'
import type { NwcPool } from './pool'
import type { WebhookDispatcher } from '../webhook'
import {
  anchorWalletActivity,
  loadWalletLiveness,
  markWalletArchiveReported,
  recordWalletActivity
} from '../store'

/**
 * How long this service was NOT running before the current process. Idleness
 * can only be counted while something was watching: after a multi-day outage
 * the whole pool looks silent, and without this the first sweep (~60s after
 * boot) would mass-archive it — links to primary Lightning Addresses included.
 *
 * Measured from the ledger's own `updated_at` watermark
 * ({@link loadListenerLastAliveAt}), read at boot before the pool writes
 * anything. A fast restart yields ~0, which keeps the restart-cannot-reset-
 * idleness property intact.
 */
export interface ListenerDowntime {
  /** When this process read the watermark (≈ process start). */
  bootedAt: Date
  /**
   * Last ledger write by an earlier process. `null` on a fresh install (no
   * downtime to discount — nothing is old enough to archive either).
   */
  lastAliveAt: Date | null
}

export interface DeadProberDeps {
  env: ListenerEnv
  log: Logger
  pool: NwcPool
  dispatcher: WebhookDispatcher
  metrics: Metrics
  /** Shared Postgres — the liveness ledger the idle clock reads and writes. */
  db: pg.Pool
  /** Called after a delivered report so warmup errors stop reaching Sentry. */
  onArchiveReported?: (walletId: string) => void
  /**
   * Downtime to discount from every idle measurement. Omitted only in tests
   * that predate the discount; a real boot always supplies it.
   */
  downtime?: ListenerDowntime
}

/**
 * Idle time the listener was NOT around to observe, for one wallet.
 *
 * The outage window is `[lastAliveAt, bootedAt]`; the wallet's silence window is
 * `[lastActiveAt, now]`. The discount is their overlap, so:
 *
 *  - a wallet last active BEFORE the outage only has to accumulate the rest of
 *    the 48h in observed time (pre-outage silence still counts);
 *  - a wallet added AFTER boot discounts nothing — its anchor is already inside
 *    the observed window;
 *  - a fast restart discounts ~nothing, so restarting can never reset the clock.
 */
export function unobservedIdleMs(
  downtime: ListenerDowntime | undefined,
  lastActiveAt: Date
): number {
  if (!downtime?.lastAliveAt) return 0
  const outageStart = Math.max(
    downtime.lastAliveAt.getTime(),
    lastActiveAt.getTime()
  )
  return Math.max(0, downtime.bootedAt.getTime() - outageStart)
}

type ProbeResult =
  /** The wallet answered (a result, or even a NIP-47 error) — it's alive. */
  | 'alive'
  /** No reply within the window — the death signal (when relays are up). */
  | 'timeout'
  /** Transport/network error — inconclusive, retry next sweep. */
  | 'inconclusive'

/**
 * Two ways a wallet reaches the archive path, both reported to web as
 * `wallet_dead` (web owns the decision and the write — the listener never
 * touches RemoteWallet):
 *
 *  1. **Probe-confirmed death** (`reason: 'unresponsive'`). A `ready` wallet
 *     stops answering for {@link ListenerEnv.DEAD_THRESHOLD_HOURS} WHILE its
 *     relays stay connected: almost certainly a disposable LNCurl wallet its
 *     provider tore down. Confirmed with `DEAD_CONFIRMATION_PROBES` clean
 *     `get_info` timeouts before reporting.
 *
 *  2. **Idle past the archive window** (`reason: 'idle' | 'warmup_failed'`,
 *     {@link ListenerEnv.WALLET_ARCHIVE_IDLE_HOURS}, 48h by default). No probe
 *     is possible — usually there is no live client at all. This is the path
 *     warmup-stuck wallets take: `state: 'error'`, never `ready`, no
 *     notifications ever, so before issue #279 they retried every 60s forever
 *     and never reached archival (LAWALLET-LISTENER-1/2).
 *
 * The idle clock is persisted per wallet in `listener.wallet_cursors`, so a
 * restart neither resets it nor re-reports (and therefore never re-storms
 * Sentry). Reported wallets are parked in the pool: their reconnect backoff
 * jumps from the 60s ceiling to `WALLET_ARCHIVE_RETRY_MS`, which is also when
 * the report is retried if web declined to archive.
 */
export class DeadWalletProber {
  private readonly deps: DeadProberDeps
  /** Wallets already reported this lifecycle — pruned when they leave the pool. */
  private readonly reported = new Set<string>()
  /**
   * Consecutive failing-probe count per candidate. A single transient slow
   * reply must not archive a live wallet, so death is only declared after
   * `DEAD_CONFIRMATION_PROBES` clean timeouts in a row (relays up, same
   * client). Any sign of life resets it.
   */
  private readonly timeoutStreak = new Map<string, number>()
  /** Wallets whose liveness anchor is already in Postgres (skips a re-INSERT). */
  private readonly anchored = new Set<string>()
  /**
   * When web last REFUSED a report (`ignored` / `unknown_wallet`). Purely an
   * in-memory rate limit on re-reporting: the wallet is NOT archived, so it must
   * not be parked and its warmup errors must keep reaching Sentry — but a
   * decision web will keep making (wrong provider, contradicted by a payment)
   * does not need re-asking every sweep. Deliberately not persisted, so a
   * restart re-asks once.
   */
  private readonly refusedAt = new Map<string, number>()
  private running = false

  constructor(deps: DeadProberDeps) {
    this.deps = deps
  }

  /** One sweep: persist liveness, probe silent wallets, archive idle ones. */
  async evaluate(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      this.pruneDepartedWallets()
      await this.persistLiveness()
      await this.probeSilentWallets()
      await this.archiveIdleWallets()
    } catch (err) {
      this.deps.log.error({ err }, 'dead_prober.sweep_error')
    } finally {
      this.running = false
    }
  }

  /**
   * Drops per-wallet bookkeeping for wallets the pool no longer holds (archived,
   * removed, or rotated), so a long-lived process doesn't accumulate state for
   * wallets that are gone — and a re-added wallet starts from a clean slate.
   */
  private pruneDepartedWallets(): void {
    const pooled = new Set(
      this.deps.pool.livenessSnapshot().map(entry => entry.wallet.id)
    )
    if (pooled.size === 0) return
    for (const id of this.refusedAt.keys()) {
      if (!pooled.has(id)) this.refusedAt.delete(id)
    }
    for (const id of this.anchored) {
      if (!pooled.has(id)) this.anchored.delete(id)
    }
  }

  /**
   * Mirrors the pool's in-memory liveness into Postgres. Wallets that have
   * never proven anything (warmup still failing) get an anchor instead, so
   * their idle clock starts at first sighting rather than never starting.
   */
  private async persistLiveness(): Promise<void> {
    const { db, log, pool } = this.deps
    for (const entry of pool.livenessSnapshot()) {
      const walletId = entry.wallet.id
      try {
        if (entry.lastResponsiveAt) {
          await recordWalletActivity(
            db,
            walletId,
            entry.lastResponsiveAt,
            entry.state === 'ready'
          )
          this.anchored.add(walletId)
        } else if (!this.anchored.has(walletId)) {
          await anchorWalletActivity(db, walletId, new Date())
          this.anchored.add(walletId)
        }
      } catch (err) {
        // A DB blip must not stop the sweep — the next one re-persists.
        log.debug({ err, walletId }, 'dead_prober.liveness_persist_failed')
      }
    }
  }

  /** Path 1: probe-confirmed death of a subscribed but silent wallet. */
  private async probeSilentWallets(): Promise<void> {
    const { env, pool, dispatcher, metrics, log } = this.deps
    const thresholdMs = env.DEAD_THRESHOLD_HOURS * 60 * 60 * 1000
    const candidates = pool.deadCandidates(thresholdMs)
    const candidateIds = new Set(candidates.map(c => c.wallet.id))

    // Drop bookkeeping for wallets that left the pool (archived/removed) or
    // recovered — a live signal bumps lastResponsiveAt, dropping them out of
    // candidacy, which must also clear any accumulated timeout streak.
    const live = new Set(pool.subscribedClients().map(c => c.wallet.id))
    for (const id of this.reported) {
      if (!live.has(id)) this.reported.delete(id)
    }
    for (const id of this.timeoutStreak.keys()) {
      if (!candidateIds.has(id)) this.timeoutStreak.delete(id)
    }

    for (const { wallet, client, unresponsiveMs } of candidates) {
      if (this.reported.has(wallet.id)) continue
      if (this.refusedRecently(wallet.id)) continue
      // A foreground card payment is the highest-priority NWC round-trip.
      // It is itself a liveness probe, so do not contend with it using a
      // parallel maintenance get_info request.
      if (pool.hasForegroundPayment(wallet.id)) continue

      const result = await this.probe(client)
      if (result === 'alive' || result === 'inconclusive') {
        // A reply (or an ambiguous transport error) resets the streak — only
        // a sustained run of clean no-reply timeouts confirms death.
        this.timeoutStreak.delete(wallet.id)
        if (result === 'alive') pool.markResponsive(wallet.id)
        continue
      }

      // result === 'timeout' — no reply within the window.
      // A rotation/removal may have raced the probe: the client we captured
      // could now be a stale, closed one. Only trust a timeout against the
      // client the pool STILL holds for this wallet.
      if (!pool.holdsClient(wallet.id, client)) {
        this.timeoutStreak.delete(wallet.id)
        continue
      }
      // Relays must still be up — a flap during the probe is transport, not
      // death — so a dropped relay resets the streak too.
      if (!pool.relaysConnected(wallet.id)) {
        this.timeoutStreak.delete(wallet.id)
        continue
      }

      // A confirmed clean timeout (relays up, live client) — counts toward
      // death. Metered here so the counter excludes rotation/relay noise.
      metrics.deadProbesTimedOut++
      const streak = (this.timeoutStreak.get(wallet.id) ?? 0) + 1
      this.timeoutStreak.set(wallet.id, streak)
      if (streak < env.DEAD_CONFIRMATION_PROBES) {
        log.debug(
          { walletId: wallet.id, streak, need: env.DEAD_CONFIRMATION_PROBES },
          'dead_prober.timeout_streak'
        )
        continue
      }

      const unresponsiveSeconds = Math.floor(unresponsiveMs / 1000)
      log.warn(
        { walletId: wallet.id, unresponsiveSeconds, streak },
        'dead_prober.declaring_dead'
      )
      const ack = await dispatcher.sendWalletDead(
        wallet.id,
        unresponsiveSeconds,
        { reason: 'unresponsive', relaysConnected: true, everReady: true }
      )
      if (ack.applied) {
        this.reported.add(wallet.id)
        this.timeoutStreak.delete(wallet.id)
        metrics.walletsDeclaredDead++
        await this.noteReported(wallet.id)
        continue
      }
      if (ack.delivered) {
        // Web refused (e.g. this is the user's own Alby, not a disposable
        // LNCurl wallet). The wallet stays live and un-muted; only stop asking
        // for a while, so a permanently-refused report is not a per-sweep POST.
        this.noteRefused(wallet.id)
        this.timeoutStreak.delete(wallet.id)
      }
      // Not delivered → leave unreported (streak stays) so the next sweep
      // retries the report.
    }
  }

  /**
   * Path 2: the 48h rule. Applies to every pooled wallet that is not currently
   * `ready` — including the warmup-stuck ones the probe path can never see —
   * using the PERSISTED clock so a restart neither resets nor re-reports it.
   */
  private async archiveIdleWallets(): Promise<void> {
    const { db, env, log, metrics, pool, dispatcher } = this.deps
    const idleMs = env.WALLET_ARCHIVE_IDLE_HOURS * 60 * 60 * 1000
    const retryMs = env.WALLET_ARCHIVE_RETRY_MS
    const snapshot = pool.livenessSnapshot().filter(entry => {
      // `ready` belongs to the probe path: those wallets still have a live
      // client and relay state to reason about, and archiving one on silence
      // alone would skip that confirmation.
      if (entry.state === 'ready') return false
      // A wallet in a retry cycle spends part of every cycle back in
      // `connecting`, so state alone would make candidacy a coin flip — hence
      // the retry counter. A wallet still on its FIRST handshake (attempt 0,
      // e.g. a queued startup warm-up) is left alone until it settles.
      return (
        entry.state === 'error' ||
        entry.state === 'disconnected' ||
        entry.retryAttempt > 0
      )
    })
    if (snapshot.length === 0) return

    const liveness = await loadWalletLiveness(
      db,
      snapshot.map(entry => entry.wallet.id)
    )
    const now = Date.now()

    for (const entry of snapshot) {
      const walletId = entry.wallet.id
      // Never contend with (or archive under) an in-flight card payment.
      if (pool.hasForegroundPayment(walletId)) continue

      const row = liveness.get(walletId)
      const lastActiveAt = latest(row?.lastActiveAt, entry.lastResponsiveAt)
      if (!lastActiveAt) continue
      const unresponsiveMs = now - lastActiveAt.getTime()
      // Listener downtime is not wallet idleness: discount the stretch nothing
      // was watching, so a multi-day outage can't mass-archive the pool on the
      // first sweep after boot.
      const unobservedMs = unobservedIdleMs(this.deps.downtime, lastActiveAt)
      if (unresponsiveMs - unobservedMs < idleMs) {
        if (unresponsiveMs >= idleMs) {
          log.info(
            {
              walletId,
              unresponsiveSeconds: Math.floor(unresponsiveMs / 1000),
              downtimeSeconds: Math.floor(unobservedMs / 1000)
            },
            'dead_prober.idle_discounted_listener_downtime'
          )
        }
        continue
      }

      // Already reported: stay parked and hold the report until the retry
      // window elapses. This is the restart-safe throttle — the timestamp is
      // in Postgres, not in this process.
      const reportedAt = row?.archiveReportedAt
      if (reportedAt && now - reportedAt.getTime() < retryMs) {
        pool.parkWallet(walletId, retryMs)
        continue
      }

      // Web already refused this report; nothing about the wallet has changed
      // since (it is still idle), so don't re-ask until the retry window.
      if (this.refusedRecently(walletId)) continue

      // Final re-check: an in-flight retry may have completed while we were
      // reading the ledger, and a wallet that just answered must not be
      // archived on a snapshot taken a moment earlier.
      if (pool.isReady(walletId)) continue

      const everReady = entry.everReady || !!row?.readyAt
      const reason: NwcWalletDeadReason = everReady ? 'idle' : 'warmup_failed'
      const unresponsiveSeconds = Math.floor(unresponsiveMs / 1000)
      log.warn(
        { walletId, unresponsiveSeconds, reason, state: entry.state },
        'dead_prober.declaring_idle'
      )
      const ack = await dispatcher.sendWalletDead(
        walletId,
        unresponsiveSeconds,
        {
          reason,
          relaysConnected: pool.relaysConnected(walletId),
          lastState: entry.state,
          everReady
        }
      )
      if (!ack.applied) {
        // Refused, not archived: leave the wallet on its normal reconnect
        // cadence with its errors still visible, and just stop re-asking every
        // sweep. Undelivered reports keep retrying on the next one.
        if (ack.delivered) this.noteRefused(walletId)
        continue
      }

      metrics.walletsArchiveRequested++
      await this.noteReported(walletId)
      // Stop the 60s reconnect storm. The wallet is NOT removed here — once web
      // archives the row, `remote_wallet_changed` drops it from the pool.
      pool.parkWallet(walletId, retryMs)
    }
  }

  /** True while web's refusal of this wallet's report is still fresh. */
  private refusedRecently(walletId: string): boolean {
    const at = this.refusedAt.get(walletId)
    if (at === undefined) return false
    if (Date.now() - at < this.deps.env.WALLET_ARCHIVE_RETRY_MS) return true
    this.refusedAt.delete(walletId)
    return false
  }

  private noteRefused(walletId: string): void {
    this.refusedAt.set(walletId, Date.now())
  }

  /** Persist + broadcast "web knows this wallet is dead". */
  private async noteReported(walletId: string): Promise<void> {
    this.deps.onArchiveReported?.(walletId)
    try {
      await markWalletArchiveReported(this.deps.db, walletId, new Date())
    } catch (err) {
      // Losing the durable mark only costs an earlier retry next sweep.
      this.deps.log.warn(
        { err, walletId },
        'dead_prober.archive_mark_persist_failed'
      )
    }
  }

  /**
   * A single `get_info` liveness probe under a hard timeout. A resolved result
   * OR a NIP-47 error reply both mean the wallet answered (alive); only a
   * no-reply timeout is the death signal; a transport error is inconclusive.
   */
  private async probe(client: NWCClient): Promise<ProbeResult> {
    const { metrics, env } = this.deps
    metrics.deadProbesRun++

    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<ProbeResult>(resolve => {
      timer = setTimeout(() => resolve('timeout'), env.DEAD_PROBE_TIMEOUT_MS)
      timer.unref?.()
    })

    const attempt: Promise<ProbeResult> = client
      .getInfo()
      .then(() => 'alive' as const)
      .catch((err: unknown) => {
        // Check the no-reply timeout BEFORE the general Nip47Error (it's a
        // subclass). A wallet that replies with any NIP-47 error is alive.
        if (err instanceof Nip47TimeoutError) return 'timeout' as const
        if (err instanceof Nip47Error) return 'alive' as const
        // Network/relay/parse error — can't conclude death from this.
        return 'inconclusive' as const
      })

    try {
      return await Promise.race([attempt, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Most recent of the persisted and in-memory clocks. */
function latest(
  a: Date | null | undefined,
  b: Date | null | undefined
): Date | null {
  if (!a) return b ?? null
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}
