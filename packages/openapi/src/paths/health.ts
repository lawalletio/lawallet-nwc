import { z } from 'zod'
import { inlineJsonResponse, publicSecurity, withRole } from '../helpers'
import { registry } from '../registry'

const TAG = 'Health'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/health',
  tags: [TAG],
  summary: 'Check that the web app is up and can reach its database.',
  description:
    'Runs `SELECT 1` against the database. Both outcomes use this bespoke ' +
    'shape, not the standard error envelope.',
  operationId: 'health.get',
  security: publicSecurity,
  responses: {
    200: inlineJsonResponse(
      'The app and its database are up.',
      z.object({
        status: z.literal('ok'),
        service: z.literal('web'),
        database: z.literal('up')
      })
    ),
    503: inlineJsonResponse(
      'The database query failed.',
      z.object({
        status: z.literal('error'),
        service: z.literal('web'),
        database: z.literal('down'),
        message: z.string(),
        detail: z.string().optional().openapi({
          description: 'The database error message; omitted in production.'
        })
      })
    )
  }
})
