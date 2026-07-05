import { createHmac } from 'node:crypto'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { ListenerEnv } from '../src/env'
import { signWebhook, WebhookDispatcher } from '../src/webhook'
import type { StoredEvent } from '../src/store'

const SECRET = 'listener-shared-secret-0123456789abcdef'

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused',
  LISTENER_PORT: 4100,
  LISTENER_AUTH_SECRET: SECRET,
  WEB_ORIGIN: 'http://web.test',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: false,
  RECONCILE_INTERVAL_MS: 300000,
  NWC_REQUEST_TIMEOUT_MS: 30000,
  WEBHOOK_MAX_ATTEMPTS: 3,
  EVENT_RETENTION_DAYS: 30
} as ListenerEnv

const storedEvent: StoredEvent = {
  eventKey: 'key-1',
  walletId: 'wallet-1',
  notificationType: 'payment_received',
  paymentHash: 'a'.repeat(64),
  amountMsats: 21000,
  settledAt: new Date('2026-07-01T00:00:00Z'),
  payload: {
    payment_hash: 'a'.repeat(64),
    preimage: 'b'.repeat(64),
    amount: 21000,
    fees_paid: 1000,
    settled_at: 1782777600
  },
  receivedAt: new Date('2026-07-01T00:00:01Z'),
  webhookStatus: 'pending',
  webhookAttempts: 0,
  recovered: false
}

const freshMetrics = () => ({
  startedAt: new Date(),
  eventsReceived: 0,
  eventsDuplicate: 0,
  webhooksDelivered: 0,
  webhooksFailed: 0,
  nwcRequests: 0,
  nwcRequestErrors: 0,
  reconciles: 0,
  notifiesReceived: 0,
  eventsRecovered: 0,
  catchupRuns: 0,
  catchupErrors: 0
})

describe('signWebhook', () => {
  it('signs `${timestamp}.${body}` with HMAC-SHA256 hex', () => {
    const timestamp = '1700000000000'
    const body = '{"hello":"world"}'
    const expected = createHmac('sha256', SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    expect(signWebhook(SECRET, timestamp, body)).toBe(expected)
    expect(signWebhook(SECRET, timestamp, body)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when any input changes', () => {
    const base = signWebhook(SECRET, 't', 'b')
    expect(signWebhook(SECRET, 't2', 'b')).not.toBe(base)
    expect(signWebhook(SECRET, 't', 'b2')).not.toBe(base)
    expect(
      signWebhook('another-secret-that-is-long-enough!', 't', 'b')
    ).not.toBe(base)
  })
})

describe('WebhookDispatcher.dispatch', () => {
  let query: ReturnType<typeof vi.fn>
  let dispatcher: WebhookDispatcher
  let metrics: ReturnType<typeof freshMetrics>

  beforeEach(() => {
    vi.useFakeTimers()
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    metrics = freshMetrics()
    dispatcher = new WebhookDispatcher({
      env,
      log: pino({ level: 'silent' }),
      pool: { query } as unknown as pg.Pool,
      metrics
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const markCalls = () =>
    query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE'))

  it('delivers on first 2xx and signs the request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await dispatcher.dispatch(storedEvent)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://web.test/api/webhooks/nwc')
    const headers = init.headers as Record<string, string>
    const timestamp = headers['x-lawallet-timestamp']
    expect(headers['x-lawallet-signature']).toBe(
      'sha256=' + signWebhook(SECRET, timestamp, init.body as string)
    )
    expect(metrics.webhooksDelivered).toBe(1)
    expect(markCalls()[0][1]).toEqual(['key-1', 'delivered', 1, null])
  })

  it('retries on 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = dispatcher.dispatch(storedEvent)
    await vi.runAllTimersAsync()
    await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(metrics.webhooksDelivered).toBe(1)
    expect(markCalls()[0][1]).toEqual(['key-1', 'delivered', 2, null])
  })

  it('treats non-429 4xx as permanent failure without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('bad', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await dispatcher.dispatch(storedEvent)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(metrics.webhooksFailed).toBe(1)
    expect(markCalls()[0][1]).toEqual(['key-1', 'failed', 1, 'HTTP 400'])
  })

  it('gives up after WEBHOOK_MAX_ATTEMPTS retryable failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('err', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = dispatcher.dispatch(storedEvent)
    await vi.runAllTimersAsync()
    await promise

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(metrics.webhooksFailed).toBe(1)
    expect(markCalls()[0][1]).toEqual(['key-1', 'failed', 3, 'HTTP 500'])
  })

  it('builds a payment_sent payload for payment_sent events', () => {
    const payload = dispatcher.buildPayload({
      ...storedEvent,
      notificationType: 'payment_sent'
    })
    expect(payload.type).toBe('payment_sent')
    if (payload.type === 'payment_sent') {
      expect(payload.payment.paymentHash).toBe('a'.repeat(64))
      expect(payload.payment.amountMsats).toBe(21000)
      expect(payload.payment.feesPaidMsats).toBe(1000)
    }
  })
})
