import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import { parseJson } from '../validate.js'
import type { Handlers } from '../../commands/handlers.js'
import { z } from 'zod'
import { createNwcSchema, updateNwcSchema } from '../../commands/types.js'

const makeInvoiceSchema = z.object({
  amountSats: z.number().int().positive(),
  description: z.string().max(500).optional(),
  expirySeconds: z.number().int().positive().max(86400).optional()
})

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

  app.get('/nwc-connections/:id/info', async c => {
    const id = c.req.param('id')
    return c.json({ success: true, data: await handlers.probeNwcInfo(id) })
  })

  app.post('/nwc-connections/:id/make-invoice', async c => {
    const id = c.req.param('id')
    const input = await parseJson(c, makeInvoiceSchema)
    const result = await handlers.makeInvoice(id, input, { source: 'http' })
    return c.json({ success: true, data: result })
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
