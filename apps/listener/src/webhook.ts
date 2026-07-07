import { createHash, createHmac } from 'node:crypto'
import type pg from 'pg'
import type { Logger } from 'pino'
import {
  NWC_WEBHOOK_SIGNATURE_HEADER,
  NWC_WEBHOOK_SIGNATURE_PREFIX,
  NWC_WEBHOOK_TIMESTAMP_HEADER,
  type NwcWebhookPayload
} from '@lawallet-nwc/shared'
import type { ListenerEnv } from './env'
import type { Metrics } from './metrics'
import {
  countUndelivered,
  markDelivery,
  undeliveredEvents,
  type StoredEvent
} from './store'

/** HMAC-SHA256 over `${timestamp}.${body}` — web verifies the same recipe. */
export function signWebhook(
  secret: string,
  timestamp: string,
  body: string
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

/** Backoff between inline attempts; sweep picks up whatever outlives these. */
const RETRY_DELAYS_MS = [1000, 5000, 25000, 60000, 120000]
/** Sweep-retry backoff: doubles each failed round, capped — but NEVER caps out
 *  the retries themselves. A payment webhook keeps retrying until it lands. */
const SWEEP_BACKOFF_BASE_MS = 120_000
const SWEEP_BACKOFF_MAX_MS = 60 * 60_000
/** Warn once the oldest undelivered webhook has been stuck this long. */
const BACKLOG_WARN_AFTER_MS = 10 * 60_000

interface Transactionish {
  type?: string
  payment_hash?: string
  preimage?: string
  amount?: number
  fees_paid?: number
  settled_at?: number
  invoice?: string
  description?: string
}

export interface WebhookDispatcherDeps {
  env: ListenerEnv
  log: Logger
  pool: pg.Pool
  metrics: Metrics
}

export class WebhookDispatcher {
  private readonly deps: WebhookDispatcherDeps
  private readonly webhookUrl: string
  private sweeping = false

  constructor(deps: WebhookDispatcherDeps) {
    this.deps = deps
    this.webhookUrl = new URL(
      '/api/webhooks/nwc',
      deps.env.WEB_ORIGIN
    ).toString()
  }

  buildPayload(event: StoredEvent): NwcWebhookPayload {
    const tx = (event.payload ?? {}) as Transactionish
    const type =
      event.notificationType === 'payment_sent'
        ? ('payment_sent' as const)
        : ('payment_received' as const)
    return {
      type,
      eventKey: event.eventKey,
      walletId: event.walletId,
      receivedAt: event.receivedAt.getTime(),
      ...(event.recovered ? { recovered: true } : {}),
      payment: {
        paymentHash: event.paymentHash ?? tx.payment_hash ?? '',
        preimage: tx.preimage || undefined,
        amountMsats: typeof tx.amount === 'number' ? tx.amount : undefined,
        feesPaidMsats:
          typeof tx.fees_paid === 'number' ? tx.fees_paid : undefined,
        settledAt:
          typeof tx.settled_at === 'number' ? tx.settled_at : undefined,
        invoice: tx.invoice || undefined,
        description: tx.description || undefined,
        transaction: (event.payload ?? {}) as Record<string, unknown>
      }
    }
  }

  /**
   * Delivers one stored event: up to WEBHOOK_MAX_ATTEMPTS inline attempts
   * with backoff, then marks failed for the sweep to pick up later. 2xx =
   * delivered; 4xx (except 429) = permanent for this round (bad contract —
   * don't hammer); network errors / 5xx / 429 retry.
   */
  async dispatch(event: StoredEvent): Promise<void> {
    const { env, log, pool, metrics } = this.deps
    const payload = this.buildPayload(event)
    const body = JSON.stringify(payload)
    let attempts = event.webhookAttempts

    for (let i = 0; i < env.WEBHOOK_MAX_ATTEMPTS; i++) {
      attempts++
      const outcome = await this.post(body)

      if (outcome.delivered) {
        metrics.webhooksDelivered++
        if (event.webhookAttempts > 0) {
          log.info({ eventKey: event.eventKey, attempts }, 'webhook.recovered')
        }
        await markDelivery(pool, event.eventKey, 'delivered', attempts)
        return
      }

      log.warn(
        { eventKey: event.eventKey, attempts, error: outcome.error },
        'webhook.attempt_failed'
      )

      if (!outcome.retryable || i === env.WEBHOOK_MAX_ATTEMPTS - 1) {
        metrics.webhooksFailed++
        // Defer, don't drop — the sweep keeps retrying until it lands.
        await markDelivery(
          pool,
          event.eventKey,
          'failed',
          attempts,
          outcome.error,
          this.nextAttemptAt(attempts)
        )
        return
      }

      await sleep(RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)])
    }
  }

  /**
   * One-shot listener_error webhook (connection failures etc.). Not persisted
   * and not retried — purely informational for web's activity log.
   */
  async sendListenerError(
    walletId: string | null,
    code: string,
    message: string
  ): Promise<void> {
    const now = Date.now()
    const payload: NwcWebhookPayload = {
      type: 'listener_error',
      eventKey: createHash('sha256')
        .update(`${walletId ?? 'pool'}|listener_error|${code}|${now}`)
        .digest('hex'),
      walletId: walletId ?? undefined,
      receivedAt: now,
      error: { code, message }
    }
    const outcome = await this.post(JSON.stringify(payload))
    if (!outcome.delivered) {
      this.deps.log.debug(
        { code, error: outcome.error },
        'webhook.listener_error_not_delivered'
      )
    }
  }

  /**
   * One-shot `wallet_dead` webhook: the listener saw a wallet go silent past
   * the threshold while its relays stayed connected. Web decides whether to
   * archive it (only LNCurl-provider wallets become DEAD). Not persisted and
   * not retried here — the prober re-detects on its next sweep if this failed.
   * Returns whether web accepted it (2xx) so the prober only marks reported on
   * success.
   */
  async sendWalletDead(
    walletId: string,
    unresponsiveSeconds: number
  ): Promise<boolean> {
    const now = Date.now()
    const payload: NwcWebhookPayload = {
      type: 'wallet_dead',
      eventKey: createHash('sha256')
        .update(`${walletId}|wallet_dead`)
        .digest('hex'),
      walletId,
      receivedAt: now,
      unresponsiveSeconds,
      relaysConnected: true
    }
    const outcome = await this.post(JSON.stringify(payload))
    if (!outcome.delivered) {
      this.deps.log.warn(
        { walletId, error: outcome.error },
        'webhook.wallet_dead_not_delivered'
      )
    }
    return outcome.delivered
  }

  /**
   * Re-attempts undelivered events — the "web was down" path. One attempt per
   * event per sweep (never block the loop with inline sleeps); the per-event
   * `webhook_next_attempt_at` backoff paces the rest. There is no attempt cap:
   * a payment webhook keeps retrying until the web app accepts it.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const events = await undeliveredEvents(this.deps.pool, {
        olderThanMs: 2 * 60 * 1000,
        limit: 50
      })
      for (const event of events) {
        await this.retryOnce(event)
      }
      await this.reportBacklog()
    } finally {
      this.sweeping = false
    }
  }

  /** Exponential backoff (capped at 1h, never gives up) for the next retry. */
  private nextAttemptAt(attempts: number): Date {
    const over = Math.max(0, attempts - this.deps.env.WEBHOOK_MAX_ATTEMPTS)
    const delay = Math.min(
      SWEEP_BACKOFF_BASE_MS * 2 ** over,
      SWEEP_BACKOFF_MAX_MS
    )
    return new Date(Date.now() + delay)
  }

  /** A single delivery attempt for a swept (previously-failed) event. */
  private async retryOnce(event: StoredEvent): Promise<void> {
    const { log, pool, metrics } = this.deps
    const attempts = event.webhookAttempts + 1
    const outcome = await this.post(JSON.stringify(this.buildPayload(event)))
    if (outcome.delivered) {
      metrics.webhooksDelivered++
      log.info({ eventKey: event.eventKey, attempts }, 'webhook.recovered')
      await markDelivery(pool, event.eventKey, 'delivered', attempts)
      return
    }
    metrics.webhooksFailed++
    await markDelivery(
      pool,
      event.eventKey,
      'failed',
      attempts,
      outcome.error,
      this.nextAttemptAt(attempts)
    )
  }

  /** Refresh the pending gauge and warn loudly on a persistent backlog. */
  private async reportBacklog(): Promise<void> {
    const { log, metrics, pool } = this.deps
    try {
      const { count, oldestReceivedAt } = await countUndelivered(pool)
      metrics.webhooksPending = count
      if (count > 0 && oldestReceivedAt) {
        const oldestMs = Date.now() - oldestReceivedAt.getTime()
        if (oldestMs >= BACKLOG_WARN_AFTER_MS) {
          log.warn(
            {
              pending: count,
              oldestMinutes: Math.round(oldestMs / 60000),
              webhookUrl: this.webhookUrl
            },
            'webhook.backlog — apps/web unreachable? events are queued and will keep retrying until delivered'
          )
        }
      }
    } catch (err) {
      log.debug({ err }, 'webhook.backlog_check_failed')
    }
  }

  private async post(
    body: string
  ): Promise<{ delivered: boolean; retryable: boolean; error?: string }> {
    const timestamp = String(Date.now())
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [NWC_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
          [NWC_WEBHOOK_SIGNATURE_HEADER]:
            NWC_WEBHOOK_SIGNATURE_PREFIX +
            signWebhook(this.deps.env.LISTENER_AUTH_SECRET, timestamp, body)
        },
        body,
        signal: AbortSignal.timeout(10000)
      })
      if (res.ok) return { delivered: true, retryable: false }
      const retryable = res.status >= 500 || res.status === 429
      return { delivered: false, retryable, error: `HTTP ${res.status}` }
    } catch (err) {
      return {
        delivered: false,
        retryable: true,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
