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
import { recentEvents } from '../store'
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
      const events = await recentEvents(pgPool, 50)
      const status: ListenerStatusResponse = {
        startedAt: metrics.startedAt.toISOString(),
        uptimeSeconds: Math.floor(
          (Date.now() - metrics.startedAt.getTime()) / 1000
        ),
        relays: nwcPool.relaySummary(),
        connections: nwcPool.snapshot(),
        counters: {
          eventsReceived: metrics.eventsReceived,
          eventsDuplicate: metrics.eventsDuplicate,
          webhooksDelivered: metrics.webhooksDelivered,
          webhooksFailed: metrics.webhooksFailed,
          nwcRequests: metrics.nwcRequests,
          nwcRequestErrors: metrics.nwcRequestErrors
        },
        recentEvents: events.map(event => ({
          eventKey: event.eventKey,
          walletId: event.walletId,
          type: event.notificationType,
          paymentHash: event.paymentHash,
          amountMsats: event.amountMsats,
          receivedAt: event.receivedAt.toISOString(),
          webhookStatus: event.webhookStatus
        }))
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
