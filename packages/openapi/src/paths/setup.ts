import { z } from 'zod'
import { inlineJsonResponse, publicErrorResponses, publicSecurity, withRole } from '../helpers'
import { registry } from '../registry'

const TAG = 'Setup'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/setup/status',
  tags: [TAG],
  summary: 'Check whether the platform has completed initial setup.',
  operationId: 'setup.status',
  security: publicSecurity,
  responses: {
    200: inlineJsonResponse(
      'Setup status.',
      z.object({ hasRoot: z.boolean() }),
    ),
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/setup/verify',
  tags: [TAG],
  summary: 'Read the active setup-verification token.',
  operationId: 'setup.verify.get',
  security: publicSecurity,
  responses: {
    200: {
      description: 'Plain-text verification token.',
      content: { 'text/plain': { schema: z.string() } },
    },
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/setup/verify',
  tags: [TAG],
  summary: 'Issue a fresh setup-verification token.',
  operationId: 'setup.verify.post',
  security: publicSecurity,
  responses: {
    200: inlineJsonResponse(
      'Newly issued token.',
      z.object({ token: z.string() }),
    ),
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'options',
  path: '/api/setup/verify',
  tags: [TAG],
  summary: 'CORS preflight for /api/setup/verify.',
  operationId: 'setup.verify.options',
  security: publicSecurity,
  responses: { 204: { description: 'Preflight OK.' } },
})
