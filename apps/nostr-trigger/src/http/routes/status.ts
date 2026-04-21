import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import type { Handlers } from '../../commands/handlers.js'

export function statusRoutes(handlers: Handlers): Hono {
  const app = new Hono()

  app.get('/status', bearerAuth, async c => {
    return c.json({ success: true, data: await handlers.status() })
  })

  return app
}
