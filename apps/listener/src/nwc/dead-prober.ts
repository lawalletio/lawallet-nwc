import { Nip47Error, Nip47TimeoutError } from '@getalby/sdk'
import type { NWCClient } from '@getalby/sdk'
import type { Logger } from 'pino'
import type { ListenerEnv } from '../env'
import type { Metrics } from '../metrics'
import type { NwcPool } from './pool'
import type { WebhookDispatcher } from '../webhook'

export interface DeadProberDeps {
  env: ListenerEnv
  log: Logger
  pool: NwcPool
  dispatcher: WebhookDispatcher
  metrics: Metrics
}

type ProbeResult =
  /** The wallet answered (a result, or even a NIP-47 error) — it's alive. */
  | 'alive'
  /** No reply within the window — the death signal (when relays are up). */
  | 'timeout'
  /** Transport/network error — inconclusive, retry next sweep. */
  | 'inconclusive'

/**
 * Detects destroyed disposable (LNCurl) wallets. A wallet that stops answering
 * for {@link ListenerEnv.DEAD_THRESHOLD_HOURS} WHILE its relays stay connected
 * has almost certainly been torn down by its provider (ran out of sats). The
 * prober confirms candidacy with an active `get_info` probe, then REPORTS the
 * observation to web via a `wallet_dead` webhook — web owns the decision to
 * archive (only LNCurl-provider wallets become DEAD). Once web flips the row to
 * DEAD, the `remote_wallet_changed` trigger drops it from the pool, so it stops
 * being a candidate and the reconnect churn ends.
 *
 * Transport-only invariant preserved: the listener never writes RemoteWallet;
 * it only surfaces a liveness observation.
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
  private running = false

  constructor(deps: DeadProberDeps) {
    this.deps = deps
  }

  /** One sweep over the pool's dead candidates. Never throws. */
  async evaluate(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
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
        const delivered = await dispatcher.sendWalletDead(
          wallet.id,
          unresponsiveSeconds
        )
        if (delivered) {
          this.reported.add(wallet.id)
          this.timeoutStreak.delete(wallet.id)
          metrics.walletsDeclaredDead++
        }
        // Not delivered → leave unreported (streak stays) so the next sweep
        // retries the report.
      }
    } catch (err) {
      this.deps.log.error({ err }, 'dead_prober.sweep_error')
    } finally {
      this.running = false
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
