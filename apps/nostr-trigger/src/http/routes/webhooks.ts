import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import { parseJson } from '../validate.js'
import type { Handlers } from '../../commands/handlers.js'
import { createWebhookSchema } from '../../commands/types.js'

export function webhookRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.post('/webhooks', async c => {
    const input = await parseJson(c, createWebhookSchema)
    const created = await handlers.createWebhook(input, { source: 'http' })
    return c.json({ success: true, data: created }, 201)
  })

  app.delete('/webhooks/:id', async c => {
    const id = c.req.param('id')
    await handlers.deleteWebhook(id, { source: 'http' })
    return c.json({ success: true, data: { deleted: true } })
  })

  app.post('/webhooks/:id/test', async c => {
    const id = c.req.param('id')
    const result = await handlers.testWebhook(id, { source: 'http' })
    return c.json({ success: true, data: result })
  })

  return app
}
