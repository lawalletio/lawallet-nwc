import http from 'node:http'
import type pg from 'pg'
import type { Logger } from 'pino'
import {
  nwcPaymentRequestSchema,
  nwcProxyRequestSchema,
  type ListenerStatusResponse,
  type NwcPaymentResponse,
  type NwcProxyErrorCode
} from '@lawallet-nwc/shared'
import { loadActiveWalletById } from '../db'
import type { ListenerEnv } from '../env'
import type { Metrics } from '../metrics'
import { NwcPaymentService } from '../nwc/payments'
import { NwcPool, NwcPoolError } from '../nwc/pool'
import { recentEventsSafe } from '../store'
import { verifyBearer } from './auth'

const MAX_BODY_BYTES = 64 * 1024

const STATUS_BY_CODE: Record<NwcProxyErrorCode, number> = {
  validation_error: 400,
  wallet_not_found: 404,
  wallet_not_connected: 503,
  wallet_error: 502,
  timeout: 504,
  relay_error: 502
}

export interface HttpServerDeps {
  env: ListenerEnv
  log: Logger
  metrics: Metrics
  pgPool: pg.Pool
  nwcPool: NwcPool
  /** Injectable for route tests; production gets the durable implementation. */
  nwcPayments?: Pick<NwcPaymentService, 'submit' | 'status'>
}

export function createHttpServer(deps: HttpServerDeps): http.Server {
  const { env, log, metrics, pgPool, nwcPool } = deps
  const nwcPayments =
    deps.nwcPayments ??
    new NwcPaymentService({
      pool: pgPool,
      nwcPool,
      log,
      metrics,
      refreshWallet: async walletId => {
        const wallet = await loadActiveWalletById(pgPool, walletId, log)
        if (!wallet) return false
        await nwcPool.reconcileOne(walletId, wallet)
        return true
      }
    })

  return http.createServer((req, res) => {
    void route(req, res).catch(err => {
      log.error({ err, url: req.url }, 'http.unhandled_error')
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' })
      } else {
        res.destroy()
      }
    })
  })

  async function route(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const path = (req.url ?? '/').split('?')[0]

    if (req.method === 'GET' && path === '/health') {
      let db = true
      try {
        await pgPool.query('SELECT 1')
      } catch {
        db = false
      }
      // db flag is informational — the process being alive is the check
      sendJson(res, 200, { status: 'ok', db })
      return
    }

    if (req.method === 'GET' && path === '/ready') {
      // The server is created only after DB/schema bootstrap + initial wallet
      // reconciliation. Individual wallets may still be negotiating; expose
      // that distinction without making one bad wallet fail service readiness.
      sendJson(res, 200, {
        status: 'ready',
        capabilities: ['nwc_payments_v1'],
        wallets: nwcPool.readinessSummary()
      })
      return
    }

    if (
      !verifyBearer(
        req.headers.authorization,
        env.LISTENER_REQUEST_AUTH_SECRET ?? env.LISTENER_AUTH_SECRET
      )
    ) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && path === '/status') {
      // Each sub-part is computed defensively: relay/connection state is
      // in-memory and always valid, the events feed needs the DB. One failing
      // part must NEVER 500 the whole endpoint (it would make a healthy
      // listener read as "unreachable" during a transient DB blip). Failed
      // parts degrade to empty and are named in `degraded`.
      const degraded: string[] = []

      let relays: ListenerStatusResponse['relays'] = []
      try {
        relays = nwcPool.relaySummary()
      } catch (err) {
        log.warn({ err }, 'status.relay_summary_failed')
        degraded.push('relays')
      }

      let connections: ListenerStatusResponse['connections'] = []
      try {
        connections = nwcPool.snapshot()
      } catch (err) {
        log.warn({ err }, 'status.snapshot_failed')
        degraded.push('connections')
      }

      const { events, error: eventsError } = await recentEventsSafe(pgPool, 50)
      if (eventsError) {
        log.warn({ err: eventsError }, 'status.recent_events_failed')
        degraded.push('recentEvents')
      }

      const status: ListenerStatusResponse = {
        startedAt: metrics.startedAt.toISOString(),
        uptimeSeconds: Math.floor(
          (Date.now() - metrics.startedAt.getTime()) / 1000
        ),
        relays,
        connections,
        counters: {
          eventsReceived: metrics.eventsReceived,
          eventsDuplicate: metrics.eventsDuplicate,
          webhooksDelivered: metrics.webhooksDelivered,
          webhooksFailed: metrics.webhooksFailed,
          webhooksPending: metrics.webhooksPending,
          nwcRequests: metrics.nwcRequests,
          nwcRequestErrors: metrics.nwcRequestErrors,
          nwcPayments: metrics.nwcPayments,
          nwcPaymentDuplicates: metrics.nwcPaymentDuplicates,
          nwcPaymentsPending: metrics.nwcPaymentsPending,
          eventsRecovered: metrics.eventsRecovered,
          catchupRuns: metrics.catchupRuns,
          catchupErrors: metrics.catchupErrors,
          deadProbesRun: metrics.deadProbesRun,
          deadProbesTimedOut: metrics.deadProbesTimedOut,
          walletsDeclaredDead: metrics.walletsDeclaredDead
        },
        recentEvents: events.map(event => {
          // invoice / fees / preimage live only in the raw NIP-47 payload.
          const tx = (event.payload ?? {}) as {
            fees_paid?: number
            invoice?: string
            preimage?: string
          }
          return {
            eventKey: event.eventKey,
            walletId: event.walletId,
            walletName: event.walletName ?? null,
            type: event.notificationType,
            paymentHash: event.paymentHash,
            amountMsats: event.amountMsats,
            feesPaidMsats:
              typeof tx.fees_paid === 'number' ? tx.fees_paid : null,
            invoice: tx.invoice || null,
            preimage: tx.preimage || null,
            settledAt: event.settledAt
              ? Math.floor(event.settledAt.getTime() / 1000)
              : null,
            receivedAt: event.receivedAt.toISOString(),
            webhookStatus: event.webhookStatus,
            webhookAttempts: event.webhookAttempts,
            webhookLastError: event.webhookLastError ?? null,
            webhookNextAttemptAt: event.webhookNextAttemptAt
              ? event.webhookNextAttemptAt.toISOString()
              : null,
            recovered: event.recovered
          }
        }),
        ...(degraded.length ? { degraded } : {})
      }
      sendJson(res, 200, status)
      return
    }

    if (req.method === 'POST' && path === '/v1/nwc/payments') {
      let raw: string
      try {
        raw = await readBody(req, MAX_BODY_BYTES)
      } catch {
        sendJson(res, 413, { error: 'validation_error' })
        return
      }

      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        sendJson(res, 400, { error: 'validation_error' })
        return
      }
      const parsed = nwcPaymentRequestSchema.safeParse(json)
      if (!parsed.success) {
        const candidate = json as { requestId?: unknown }
        const requestId =
          typeof candidate?.requestId === 'string' &&
          /^[0-9a-f]{64}$/i.test(candidate.requestId)
            ? candidate.requestId.toLowerCase()
            : '0'.repeat(64)
        sendJson(res, 400, {
          ok: false,
          status: 'rejected',
          requestId,
          error: {
            code: 'validation_error',
            message: parsed.error.errors[0]?.message ?? 'Invalid request'
          }
        } satisfies NwcPaymentResponse)
        return
      }

      const operation = nwcPayments.submit(parsed.data)
      const result = await waitForPayment(
        operation,
        parsed.data.requestId,
        parsed.data.waitMs
      )
      sendJson(res, paymentHttpStatus(result), result)
      return
    }

    if (req.method === 'GET' && path.startsWith('/v1/nwc/payments/')) {
      const requestId = path.slice('/v1/nwc/payments/'.length).toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(requestId)) {
        sendJson(res, 400, {
          ok: false,
          status: 'unknown',
          requestId: '0'.repeat(64),
          error: {
            code: 'validation_error',
            message: 'requestId must be a 64-character hex string'
          }
        } satisfies NwcPaymentResponse)
        return
      }
      const result = await nwcPayments.status(requestId)
      sendJson(res, paymentHttpStatus(result), result)
      return
    }

    if (req.method === 'POST' && path === '/nwc/request') {
      let raw: string
      try {
        raw = await readBody(req, MAX_BODY_BYTES)
      } catch {
        sendJson(res, 413, {
          ok: false,
          error: { code: 'validation_error', message: 'Body too large' }
        })
        return
      }

      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        sendProxyError(res, 'validation_error', 'Invalid JSON body')
        return
      }
      const parsed = nwcProxyRequestSchema.safeParse(json)
      if (!parsed.success) {
        sendProxyError(
          res,
          'validation_error',
          parsed.error.errors[0]?.message ?? 'Invalid request'
        )
        return
      }

      const { connectionString, walletId, method, params, timeoutMs } =
        parsed.data
      metrics.nwcRequests++
      try {
        const result = await nwcPool.request(
          connectionString,
          method,
          params,
          timeoutMs ?? env.NWC_REQUEST_TIMEOUT_MS
        )
        sendJson(res, 200, { ok: true, result: result ?? {} })
      } catch (err) {
        metrics.nwcRequestErrors++
        if (err instanceof NwcPoolError) {
          log.warn(
            { walletId, method, code: err.code, err },
            'nwc_request.failed'
          )
          sendProxyError(res, err.code, err.message, err.walletErrorCode)
        } else {
          log.error({ walletId, method, err }, 'nwc_request.unexpected_error')
          sendProxyError(res, 'relay_error', 'Unexpected NWC transport error')
        }
      }
      return
    }

    sendJson(res, 404, { error: 'not_found' })
  }
}

function paymentHttpStatus(response: NwcPaymentResponse): number {
  if (response.ok) return 200
  if (response.error?.code === 'request_not_found') return 404
  if (response.error?.code === 'request_conflict') return 409
  if (response.error?.code === 'validation_error') return 400
  if (response.status === 'not_started') return 503
  if (response.status === 'rejected') return 422
  return 202
}

/** HTTP long-poll only; the shared SDK promise is deliberately not cancelled. */
async function waitForPayment(
  operation: Promise<NwcPaymentResponse>,
  requestId: string,
  waitMs: number
): Promise<NwcPaymentResponse> {
  let timer: NodeJS.Timeout | null = null
  const pending = new Promise<NwcPaymentResponse>(resolve => {
    timer = setTimeout(
      () => resolve({ ok: false, status: 'pending', requestId }),
      waitMs
    )
  })
  try {
    return await Promise.race([operation, pending])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function sendProxyError(
  res: http.ServerResponse,
  code: NwcProxyErrorCode,
  message: string,
  walletErrorCode?: string
): void {
  sendJson(res, STATUS_BY_CODE[code], {
    ok: false,
    error: { code, message, ...(walletErrorCode ? { walletErrorCode } : {}) }
  })
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function readBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
