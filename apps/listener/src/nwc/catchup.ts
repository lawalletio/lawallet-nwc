import { Nip47WalletError } from '@getalby/sdk'
import type {
  NWCClient,
  Nip47Notification,
  Nip47Transaction
} from '@getalby/sdk'
import type pg from 'pg'
import type { Logger } from 'pino'
import type { ListenerEnv } from '../env'
import type { Metrics } from '../metrics'
import type { DesiredWallet } from '../db'
import { advanceCursor, getCursor, seedCursorIfMissing } from '../store'

const PAGE_LIMIT = 50
/** Hard cap so a pathological wallet can't keep us paginating forever. */
const MAX_PAGES = 20
const RELAY_REPLAY_TIMEOUT_MS = 10000

export interface CatchupWindow {
  fromSec: number
  untilSec: number
}

/**
 * Pure window planner. `null` means "nothing to do": either the wallet has no
 * cursor yet (caller seeds it at now — recovery covers downtime, it never
 * imports pre-existing wallet history) or the window is empty.
 */
export function planCatchupWindow(input: {
  cursor: Date | null
  now: Date
  maxWindowMs: number
  overlapMs: number
}): CatchupWindow | null {
  if (!input.cursor) return null
  const floor = input.now.getTime() - input.maxWindowMs
  const from = Math.max(input.cursor.getTime() - input.overlapMs, floor)
  const until = input.now.getTime()
  if (from >= until) return null
  return {
    fromSec: Math.floor(from / 1000),
    untilSec: Math.ceil(until / 1000)
  }
}

export interface CatchupDeps {
  env: ListenerEnv
  log: Logger
  pool: pg.Pool
  metrics: Metrics
  /**
   * The SAME pipeline live notifications go through (dedup → webhook).
   * Returns true when the event was new (not a dedup hit) so recovery
   * metrics only count actual recoveries.
   */
  process: (
    wallet: DesiredWallet,
    notification: Nip47Notification
  ) => Promise<boolean>
}

/**
 * Hybrid missed-event recovery, anchored on the per-wallet persisted cursor:
 *
 *  1. Wallet path (primary): NIP-47 `list_transactions` — the wallet's own
 *     ledger, works regardless of relay retention. Wallets that answer
 *     NOT_IMPLEMENTED are remembered and skipped (reset on full reconcile).
 *  2. Relay path (best-effort): a one-shot REQ with `since` for notification
 *     kinds 23196/23197. Those kinds are EPHEMERAL per NIP-01, so most relays
 *     return nothing — this only pays off on NWC relays that retain them.
 *
 * Both paths feed the normal dedup pipeline, so overlaps (with each other and
 * with the live stream) are free. The cursor only advances after a successful
 * run — failures leave it in place so the next attempt retries the window.
 */
export class CatchupRunner {
  private readonly deps: CatchupDeps
  private readonly inFlight = new Set<string>()
  private readonly listTransactionsUnsupported = new Set<string>()
  private readonly lastCatchupAt = new Map<string, Date>()

  constructor(deps: CatchupDeps) {
    this.deps = deps
  }

  /** Wallets may gain list_transactions after upgrades — retry periodically. */
  resetUnsupported(): void {
    this.listTransactionsUnsupported.clear()
  }

  getLastCatchupAt(walletId: string): Date | undefined {
    return this.lastCatchupAt.get(walletId)
  }

  async runForWallet(wallet: DesiredWallet, client: NWCClient): Promise<void> {
    const { env, log, pool, metrics } = this.deps
    if (this.inFlight.has(wallet.id)) return
    this.inFlight.add(wallet.id)
    try {
      const cursor = await getCursor(pool, wallet.id)
      const now = new Date()
      if (!cursor) {
        await seedCursorIfMissing(pool, wallet.id, now)
        log.debug({ walletId: wallet.id }, 'catchup.cursor_seeded')
        return
      }

      const window = planCatchupWindow({
        cursor,
        now,
        maxWindowMs: env.CATCHUP_MAX_WINDOW_HOURS * 60 * 60 * 1000,
        overlapMs: env.CATCHUP_OVERLAP_SECONDS * 1000
      })
      if (!window) return

      metrics.catchupRuns++
      let recovered = 0
      recovered += await this.walletCatchup(wallet, client, window)
      recovered += await this.relayReplay(wallet, client, window)

      await advanceCursor(pool, wallet.id, new Date(window.untilSec * 1000))
      this.lastCatchupAt.set(wallet.id, now)
      metrics.eventsRecovered += recovered

      if (recovered > 0) {
        log.info(
          { walletId: wallet.id, recovered, ...window },
          'catchup.recovered'
        )
      } else {
        log.debug({ walletId: wallet.id, ...window }, 'catchup.clean')
      }
    } catch (err) {
      // Cursor NOT advanced — the same window is retried on the next run.
      metrics.catchupErrors++
      log.warn({ err, walletId: wallet.id }, 'catchup.failed')
    } finally {
      this.inFlight.delete(wallet.id)
    }
  }

  /** Primary path: page through the wallet's own settled transactions. */
  private async walletCatchup(
    wallet: DesiredWallet,
    client: NWCClient,
    window: CatchupWindow
  ): Promise<number> {
    if (this.listTransactionsUnsupported.has(wallet.id)) return 0
    const { log } = this.deps

    let recovered = 0
    let offset = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      let response
      try {
        response = await client.listTransactions({
          from: window.fromSec,
          until: window.untilSec,
          limit: PAGE_LIMIT,
          offset
        })
      } catch (err) {
        if (err instanceof Nip47WalletError && err.code === 'NOT_IMPLEMENTED') {
          this.listTransactionsUnsupported.add(wallet.id)
          log.warn(
            { walletId: wallet.id },
            'catchup.list_transactions_unsupported — relying on relay replay only'
          )
          return recovered
        }
        throw err
      }

      const transactions = response.transactions ?? []
      for (const tx of transactions) {
        if (tx.state !== 'settled') continue
        const isNew = await this.deps.process(wallet, toNotification(tx))
        if (isNew) recovered++
      }

      offset += transactions.length
      const totalCount = response.total_count
      const done =
        transactions.length < PAGE_LIMIT ||
        (typeof totalCount === 'number' && offset >= totalCount)
      if (done) return recovered
    }

    log.warn(
      { walletId: wallet.id, scanned: offset },
      'catchup.pagination_capped — remaining transactions covered by next run'
    )
    return recovered
  }

  /**
   * Best-effort relay replay — never fails the run. Events that don't decrypt
   * (foreign encryption type) or don't parse are skipped quietly.
   */
  private relayReplay(
    wallet: DesiredWallet,
    client: NWCClient,
    window: CatchupWindow
  ): Promise<number> {
    const { log } = this.deps
    return new Promise(resolve => {
      let recovered = 0
      let finished = false
      const pending: Promise<void>[] = []
      let sub: { close: () => void } | null = null

      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        try {
          sub?.close()
        } catch {
          // best-effort
        }
        void Promise.allSettled(pending).then(() => resolve(recovered))
      }
      const timer = setTimeout(finish, RELAY_REPLAY_TIMEOUT_MS)
      timer.unref?.()

      try {
        sub = client.pool.subscribe(
          client.relayUrls,
          {
            kinds: [23196, 23197],
            authors: [client.walletPubkey],
            '#p': [client.publicKey],
            since: window.fromSec
          },
          {
            onevent: event => {
              pending.push(
                (async () => {
                  try {
                    const decrypted = await client.decrypt(
                      client.walletPubkey,
                      event.content
                    )
                    const parsed = JSON.parse(decrypted) as {
                      notification_type?: string
                      notification?: Nip47Transaction
                    }
                    if (
                      (parsed.notification_type !== 'payment_received' &&
                        parsed.notification_type !== 'payment_sent') ||
                      !parsed.notification
                    ) {
                      return
                    }
                    const isNew = await this.deps.process(
                      wallet,
                      parsed as Nip47Notification
                    )
                    if (isNew) recovered++
                  } catch (err) {
                    log.debug(
                      { err, walletId: wallet.id },
                      'catchup.relay_replay_event_skipped'
                    )
                  }
                })()
              )
            },
            oneose: finish
          }
        )
      } catch (err) {
        log.debug(
          { err, walletId: wallet.id },
          'catchup.relay_replay_unavailable'
        )
        finish()
      }
    })
  }
}

function toNotification(tx: Nip47Transaction): Nip47Notification {
  return {
    notification_type:
      tx.type === 'incoming' ? 'payment_received' : 'payment_sent',
    notification: tx
  } as Nip47Notification
}
