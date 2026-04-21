import { createHmac } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { createChildLogger } from '../logger.js'
import { decryptSecret } from '../security/crypto.js'
import { getConfig } from '../config/index.js'

const log = createChildLogger({ module: 'webhook-dispatcher' })

export type WebhookJobData = {
  webhookEndpointId: string
  eventId: string
  eventKind: number
  nwcConnectionId: string
  payload: unknown
}

export type DispatchResult =
  | { kind: 'success'; status: number }
  | { kind: 'retryable'; status: number | null; reason: string }
  | { kind: 'terminal'; status: number; reason: string }

/**
 * Delivers one webhook job. Classification:
 *   2xx          → success
 *   4xx (!= 408/429) → terminal (no retry)
 *   5xx / 408 / 429 / network / timeout → retryable
 */
export async function dispatchWebhook(
  data: WebhookJobData
): Promise<DispatchResult> {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: data.webhookEndpointId }
  })

  if (!endpoint) {
    return {
      kind: 'terminal',
      status: 0,
      reason: 'endpoint no longer exists'
    }
  }
  if (!endpoint.enabled) {
    return {
      kind: 'terminal',
      status: 0,
      reason: 'endpoint disabled'
    }
  }

  const body = JSON.stringify({
    event_id: data.eventId,
    event_kind: data.eventKind,
    nwc_connection_id: data.nwcConnectionId,
    payload: data.payload,
    ts: new Date().toISOString()
  })

  const secretPlain = decryptSecret(endpoint.secret)
  const signature = createHmac('sha256', secretPlain).update(body).digest('hex')

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    getConfig().webhook.timeoutMs
  )

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'lawallet-nostr-trigger/0.9.0',
        'Idempotency-Key': data.eventId,
        'X-LaWallet-Signature': `sha256=${signature}`,
        'X-LaWallet-Event-Kind': String(data.eventKind),
        'X-LaWallet-Nwc-Id': data.nwcConnectionId
      },
      body,
      signal: controller.signal
    })

    if (res.status >= 200 && res.status < 300) {
      return { kind: 'success', status: res.status }
    }

    // Retryable: 5xx, 408 Request Timeout, 429 Too Many Requests
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      return {
        kind: 'retryable',
        status: res.status,
        reason: `http ${res.status}`
      }
    }

    // Other 4xx → terminal
    return {
      kind: 'terminal',
      status: res.status,
      reason: `http ${res.status}`
    }
  } catch (err) {
    log.warn(
      { err, endpointId: endpoint.id, eventId: data.eventId },
      'webhook network error'
    )
    return {
      kind: 'retryable',
      status: null,
      reason: (err as Error).message
    }
  } finally {
    clearTimeout(timeout)
  }
}
