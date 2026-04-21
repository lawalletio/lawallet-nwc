import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import { parseJson } from '../validate.js'
import type { Handlers } from '../../commands/handlers.js'
import { createNwcSchema, updateNwcSchema } from '../../commands/types.js'

export function connectionRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.get('/nwc-connections', async c => {
    return c.json({ success: true, data: await handlers.listNwc() })
  })

  app.post('/nwc-connections', async c => {
    const input = await parseJson(c, createNwcSchema)
    const created = await handlers.createNwc(input, { source: 'http' })
    return c.json({ success: true, data: created }, 201)
  })

  app.get('/nwc-connections/:id', async c => {
    const id = c.req.param('id')
    return c.json({ success: true, data: await handlers.getNwc(id) })
  })

  app.patch('/nwc-connections/:id', async c => {
    const id = c.req.param('id')
    const input = await parseJson(c, updateNwcSchema)
    const updated = await handlers.updateNwc(id, input, { source: 'http' })
    return c.json({ success: true, data: updated })
  })

  app.delete('/nwc-connections/:id', async c => {
    const id = c.req.param('id')
    await handlers.deleteNwc(id, { source: 'http' })
    return c.json({ success: true, data: { deleted: true } })
  })

  app.get('/nwc-connections/:id/webhooks', async c => {
    const id = c.req.param('id')
    return c.json({ success: true, data: await handlers.listWebhooks(id) })
  })

  return app
}
