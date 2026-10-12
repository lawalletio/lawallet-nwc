import { createHmac } from 'node:crypto'
import type { Logger } from 'pino'
import { zapSettleAckSchema } from '@lawallet-nwc/shared'
import type { ListenerEnv } from './env'

/**
 * What web said about its zap backlog. `pending: null` means it didn't say —
 * an older web build, a rejection, or web being unreachable.
 */
export interface ZapSettleOutcome {
  pending: boolean | null
  nextPollAt: Date | null
}

const UNKNOWN: ZapSettleOutcome = { pending: null, nextPollAt: null }

/**
 * Wakes web's zap settlement sweep.
 *
 * `payment_received` is the fast path for NIP-57, but NIP-47 makes
 * `notifications` optional — a wallet that implements none would leave every
 * zap invoice pending and unreceipted. This tick lets web ask those wallets
 * directly with `lookup_invoice`.
 *
 * The listener stays transport-only here: it carries no settlement opinion and
 * names no invoice. Web selects the candidates and decides what settled means;
 * it only tells us whether there is anything left to wake it for.
 */
export async function requestZapSettlement(
  env: ListenerEnv,
  log: Logger
): Promise<ZapSettleOutcome> {
  const raw = JSON.stringify({})
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', env.LISTENER_AUTH_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest('hex')

  try {
    const response = await fetch(
      new URL('/api/internal/zaps/settle', env.WEB_ORIGIN),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lawallet-timestamp': timestamp,
          'x-lawallet-signature': `sha256=${signature}`
        },
        body: raw,
        signal: AbortSignal.timeout(30_000)
      }
    )
    if (!response.ok) {
      // A 404 is the expected answer from a web build that predates this
      // endpoint, so this stays a warning rather than an error.
      log.warn({ status: response.status }, 'zap_settle.web_rejected_request')
      return UNKNOWN
    }
    const result = await response.json().catch(() => null)
    log.debug({ result }, 'zap_settle.completed')
    const ack = zapSettleAckSchema.safeParse(result)
    if (!ack.success || ack.data.pending === undefined) return UNKNOWN
    const nextPollAt = ack.data.nextPollAt
      ? new Date(ack.data.nextPollAt)
      : null
    return {
      pending: ack.data.pending,
      nextPollAt:
        nextPollAt && !Number.isNaN(nextPollAt.getTime()) ? nextPollAt : null
    }
  } catch (err) {
    log.warn({ err }, 'zap_settle.web_unreachable')
    return UNKNOWN
  }
}

/**
 * Self-scheduling zap tick. While web reports open zap invoices it ticks at
 * `fastMs` (or later, when web says the next one isn't due yet); while web
 * reports none it doubles the gap up to `maxMs`. `wake()` drops back to the
 * fast cadence — called when a payment notification or a freshly minted
 * invoice suggests a zap may be in flight. An outcome of "unknown" keeps the
 * fast cadence, which is exactly what a listener did before web could answer.
 */
export class ZapSettleScheduler {
  private readonly fastMs: number
  private readonly maxMs: number
  private idleDelayMs: number
  private timer: NodeJS.Timeout | null = null
  private dueAt = 0
  private running = false
  private woken = false
  private stopped = true

  constructor(
    private readonly tick: () => Promise<ZapSettleOutcome>,
    opts: { fastMs: number; maxMs: number }
  ) {
    this.fastMs = opts.fastMs
    this.maxMs = Math.max(opts.maxMs, opts.fastMs)
    this.idleDelayMs = this.fastMs
  }

  start(): void {
    this.stopped = false
    this.schedule(this.fastMs)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Something zap-shaped happened: tick at the fast cadence again. */
  wake(): void {
    if (this.stopped) return
    this.idleDelayMs = this.fastMs
    if (this.running) {
      this.woken = true
      return
    }
    if (this.dueAt - Date.now() > this.fastMs) this.schedule(this.fastMs)
  }

  /** The gap that follows an outcome. Exposed for tests. */
  nextDelay(outcome: ZapSettleOutcome, now = Date.now()): number {
    if (outcome.pending === null) {
      this.idleDelayMs = this.fastMs
      return this.fastMs
    }
    if (outcome.pending) {
      this.idleDelayMs = this.fastMs
      const untilDue = outcome.nextPollAt
        ? outcome.nextPollAt.getTime() - now
        : 0
      return Math.min(Math.max(untilDue, this.fastMs), this.maxMs)
    }
    this.idleDelayMs = Math.min(this.idleDelayMs * 2, this.maxMs)
    return this.idleDelayMs
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.dueAt = Date.now() + delayMs
    this.timer = setTimeout(() => void this.run(), delayMs)
    this.timer.unref()
  }

  private async run(): Promise<void> {
    this.timer = null
    this.running = true
    this.woken = false
    let outcome = UNKNOWN
    try {
      outcome = await this.tick()
    } catch {
      // requestZapSettlement never throws; an injected tick might.
    } finally {
      this.running = false
    }
    if (this.stopped) return
    const delay = this.nextDelay(outcome)
    this.schedule(this.woken ? Math.min(delay, this.fastMs) : delay)
  }
}
