import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import { parseJson } from '../validate.js'
import type { Handlers } from '../../commands/handlers.js'
import { publishZapSchema } from '../../commands/types.js'

export function zapRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.post('/zap/publish', async c => {
    const input = await parseJson(c, publishZapSchema)
    const result = await handlers.publishZap(input, { source: 'http' })
    return c.json({ success: true, data: result })
  })

  return app
}
