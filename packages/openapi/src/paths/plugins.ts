import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'

const TAG = 'Plugins'

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/plugins',
  tags: [TAG],
  summary: 'List registered plugins and whether each is enabled.',
  operationId: 'plugins.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Registered plugins.',
      z.object({
        plugins: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            version: z.string(),
            description: z.string().optional(),
            enabled: z.boolean()
          })
        )
      })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'patch',
  path: '/api/plugins/{plugin}',
  tags: [TAG],
  summary: 'Enable or disable a plugin.',
  description:
    'Requires `settings:write`. Stores the `plugin.<id>.enabled` setting, runs ' +
    'the plugin’s idempotent `migrate()` when enabling, and dispatches the ' +
    '`plugin:toggled` hook.',
  operationId: 'plugins.update',
  security: protectedSecurity,
  request: {
    params: z.object({
      plugin: z.string().openapi({ example: 'badges' })
    }),
    body: {
      content: {
        'application/json': { schema: z.object({ enabled: z.boolean() }) }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'The plugin’s resulting state.',
      z.object({ id: z.string(), enabled: z.boolean() })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})
