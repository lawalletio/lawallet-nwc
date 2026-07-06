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
import { markDelivery, undeliveredEvents, type StoredEvent } from './store'

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
/** Hard attempt cap across inline retries + sweep re-dispatches. */
const SWEEP_MAX_ATTEMPTS = 25

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
        await markDelivery(pool, event.eventKey, 'delivered', attempts)
        return
      }

      log.warn(
        { eventKey: event.eventKey, attempts, error: outcome.error },
        'webhook.attempt_failed'
      )

      if (!outcome.retryable || i === env.WEBHOOK_MAX_ATTEMPTS - 1) {
        metrics.webhooksFailed++
        await markDelivery(
          pool,
          event.eventKey,
          'failed',
          attempts,
          outcome.error
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

  /** Re-attempts undelivered events — the "web was down for an hour" path. */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const events = await undeliveredEvents(this.deps.pool, {
        maxAttempts: SWEEP_MAX_ATTEMPTS,
        olderThanMs: 2 * 60 * 1000,
        limit: 50
      })
      for (const event of events) {
        await this.dispatch(event)
      }
    } finally {
      this.sweeping = false
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
