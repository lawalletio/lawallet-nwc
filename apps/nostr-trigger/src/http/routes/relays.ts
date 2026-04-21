import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import type { Handlers } from '../../commands/handlers.js'

export function relayRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.get('/relays', async c => {
    return c.json({ success: true, data: await handlers.listRelays() })
  })

  app.post('/relays/reload', async c => {
    const result = await handlers.reloadRelays({ source: 'http' })
    return c.json({ success: true, data: result })
  })

  return app
}
