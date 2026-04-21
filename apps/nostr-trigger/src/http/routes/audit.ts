import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import type { Handlers } from '../../commands/handlers.js'

export function auditRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.get('/audit', async c => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10)
    return c.json({ success: true, data: await handlers.auditTail(limit) })
  })

  return app
}
