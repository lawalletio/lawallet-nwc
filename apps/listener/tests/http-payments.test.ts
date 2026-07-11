import type { AddressInfo } from 'node:net'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { NwcPaymentResponse } from '@lawallet-nwc/shared'
import type { ListenerEnv } from '../src/env'
import { createHttpServer } from '../src/http/server'
import { metrics as baseMetrics, type Metrics } from '../src/metrics'
import type { NwcPool } from '../src/nwc/pool'

const LEGACY_SECRET = 'legacy-listener-secret-0123456789abcdef'
const REQUEST_SECRET = 'request-listener-secret-0123456789abcdef'
const requestId = 'a'.repeat(64)

const env = {
  LISTENER_AUTH_SECRET: LEGACY_SECRET,
  LISTENER_REQUEST_AUTH_SECRET: REQUEST_SECRET,
  NWC_REQUEST_TIMEOUT_MS: 30000
} as ListenerEnv

function freshMetrics(): Metrics {
  return { ...baseMetrics, startedAt: new Date() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('idempotent payment HTTP API', () => {
  const servers: ReturnType<typeof createHttpServer>[] = []

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          server => new Promise<void>(resolve => server.close(() => resolve()))
        )
    )
  })

  function start(payments: {
    submit: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }) {
    const server = createHttpServer({
      env,
      log: pino({ level: 'silent' }),
      metrics: freshMetrics(),
      pgPool: {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      } as unknown as pg.Pool,
      nwcPool: {
        readinessSummary: vi.fn(() => ({ total: 2, ready: 1, notReady: 1 }))
      } as unknown as NwcPool,
      nwcPayments: payments
    })
    servers.push(server)
    return new Promise<string>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const { port } = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${port}`)
      })
    })
  }

  let payments: {
    submit: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    payments = { submit: vi.fn(), status: vi.fn() }
  })

  it('routes a walletId payment and returns a confirmed success', async () => {
    payments.submit.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId,
      preimage: 'b'.repeat(64),
      feesPaidMsats: 1000
    } satisfies NwcPaymentResponse)
    const origin = await start(payments)

    const response = await fetch(`${origin}/v1/nwc/payments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${REQUEST_SECRET}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        requestId,
        walletId: 'wallet-1',
        invoice: 'lnbc1invoice',
        paymentHash: 'c'.repeat(64),
        waitMs: 8000
      })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'succeeded'
    })
    expect(payments.submit).toHaveBeenCalledWith({
      requestId,
      walletId: 'wallet-1',
      invoice: 'lnbc1invoice',
      paymentHash: 'c'.repeat(64),
      waitMs: 8000
    })
  })

  it('advertises the stable payment capability without authentication', async () => {
    const origin = await start(payments)
    const response = await fetch(`${origin}/ready`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ready',
      capabilities: ['nwc_payments_v1'],
      wallets: { total: 2, ready: 1, notReady: 1 }
    })
  })

  it('returns 202 after the long-poll budget without cancelling the operation', async () => {
    const operation = deferred<NwcPaymentResponse>()
    payments.submit.mockReturnValue(operation.promise)
    const origin = await start(payments)

    const response = await fetch(`${origin}/v1/nwc/payments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${REQUEST_SECRET}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        requestId,
        walletId: 'wallet-1',
        invoice: 'lnbc1invoice',
        paymentHash: 'c'.repeat(64),
        waitMs: 100
      })
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: 'pending',
      requestId
    })

    // Resolving after the response remains safe: Promise.race never aborted
    // or rejected the service-owned operation.
    operation.resolve({
      ok: true,
      status: 'succeeded',
      requestId,
      preimage: 'b'.repeat(64),
      feesPaidMsats: 0
    })
    await expect(operation.promise).resolves.toMatchObject({
      status: 'succeeded'
    })
  })

  it('maps not_started and request conflicts to their safe HTTP statuses', async () => {
    payments.submit
      .mockResolvedValueOnce({
        ok: false,
        status: 'not_started',
        requestId,
        error: { code: 'wallet_not_ready', message: 'not ready' }
      } satisfies NwcPaymentResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 'rejected',
        requestId,
        error: { code: 'request_conflict', message: 'conflict' }
      } satisfies NwcPaymentResponse)
    const origin = await start(payments)
    const init = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${REQUEST_SECRET}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        requestId,
        walletId: 'wallet-1',
        invoice: 'lnbc1invoice',
        paymentHash: 'c'.repeat(64)
      })
    }

    expect((await fetch(`${origin}/v1/nwc/payments`, init)).status).toBe(503)
    expect((await fetch(`${origin}/v1/nwc/payments`, init)).status).toBe(409)
  })

  it('exposes durable status and uses the dedicated request secret', async () => {
    payments.status.mockResolvedValue({
      ok: false,
      status: 'unknown',
      requestId,
      error: { code: 'request_not_found', message: 'missing' }
    } satisfies NwcPaymentResponse)
    const origin = await start(payments)

    const legacyAuth = await fetch(`${origin}/v1/nwc/payments/${requestId}`, {
      headers: { authorization: `Bearer ${LEGACY_SECRET}` }
    })
    expect(legacyAuth.status).toBe(401)

    const response = await fetch(`${origin}/v1/nwc/payments/${requestId}`, {
      headers: { authorization: `Bearer ${REQUEST_SECRET}` }
    })
    expect(response.status).toBe(404)
    expect(payments.status).toHaveBeenCalledWith(requestId)
  })
})
