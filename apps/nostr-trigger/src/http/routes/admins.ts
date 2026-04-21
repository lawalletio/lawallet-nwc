import { Hono } from 'hono'
import { bearerAuth } from '../auth.js'
import { parseJson } from '../validate.js'
import type { Handlers } from '../../commands/handlers.js'
import { addAdminSchema } from '../../commands/types.js'

export function adminRoutes(handlers: Handlers): Hono {
  const app = new Hono()
  app.use('*', bearerAuth)

  app.get('/admins', async c => {
    return c.json({ success: true, data: await handlers.listAdmins() })
  })

  app.post('/admins', async c => {
    const input = await parseJson(c, addAdminSchema)
    const created = await handlers.addAdmin(input, { source: 'http' })
    return c.json({ success: true, data: created }, 201)
  })

  app.delete('/admins/:id', async c => {
    const id = c.req.param('id')
    await handlers.removeAdmin(id, { source: 'http' })
    return c.json({ success: true, data: { removed: true } })
  })

  return app
}
