import { Hono } from 'hono'
import { logger as loggerMw } from 'hono/logger'
import { ApiError, toApiError, type ApiResponse } from './errors.js'
import { createChildLogger } from '../logger.js'
import type { Handlers } from '../commands/handlers.js'
import { statusRoutes } from './routes/status.js'
import { connectionRoutes } from './routes/connections.js'
import { webhookRoutes } from './routes/webhooks.js'
import { relayRoutes } from './routes/relays.js'
import { adminRoutes } from './routes/admins.js'
import { auditRoutes } from './routes/audit.js'
import { zapRoutes } from './routes/zap.js'

const log = createChildLogger({ module: 'http' })

export function buildServer(handlers: Handlers): Hono {
  const app = new Hono()

  app.use(
    '*',
    loggerMw((message, ...rest) => {
      log.info({ extra: rest }, message)
    })
  )

  // public liveness/readiness — no auth
  app.get('/health', c =>
    c.json({ success: true, data: { status: 'ok' } })
  )
  app.get('/ready', async c => {
    try {
      const status = await handlers.status()
      return c.json({ success: true, data: { status: 'ready', ...status } })
    } catch (err) {
      return c.json(
        { success: false, error: { message: (err as Error).message, code: 'NOT_READY' } },
        503
      )
    }
  })

  const v1 = new Hono()
  v1.route('/', statusRoutes(handlers))
  v1.route('/', connectionRoutes(handlers))
  v1.route('/', webhookRoutes(handlers))
  v1.route('/', relayRoutes(handlers))
  v1.route('/', adminRoutes(handlers))
  v1.route('/', auditRoutes(handlers))
  v1.route('/', zapRoutes(handlers))

  app.route('/api/v1', v1)

  app.onError((err, c) => {
    const apiErr: ApiError = toApiError(err)
    const body: ApiResponse<never> = {
      success: false,
      error: {
        message: apiErr.message,
        code: apiErr.code,
        details: apiErr.details
      }
    }
    if (apiErr.statusCode >= 500) {
      log.error({ err: apiErr, path: c.req.path }, 'request failed')
    }
    return c.json(body, apiErr.statusCode as 400 | 401 | 403 | 404 | 409 | 500)
  })

  app.notFound(c =>
    c.json(
      {
        success: false,
        error: { message: 'Route not found', code: 'NOT_FOUND' }
      },
      404
    )
  )

  return app
}
