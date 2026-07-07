import http from 'node:http'
import type pg from 'pg'
import type { Logger } from 'pino'
import {
  nwcProxyRequestSchema,
  type ListenerStatusResponse,
  type NwcProxyErrorCode
} from '@lawallet-nwc/shared'
import type { ListenerEnv } from '../env'
import type { Metrics } from '../metrics'
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
}

export function createHttpServer(deps: HttpServerDeps): http.Server {
  const { env, log, metrics, pgPool, nwcPool } = deps

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

    if (!verifyBearer(req.headers.authorization, env.LISTENER_AUTH_SECRET)) {
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
