import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { schemas } from '../schemas'

const TAG = 'Settings'

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/settings',
  tags: [TAG],
  summary: 'Read settings; anonymous callers see public keys only.',
  operationId: 'settings.get',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Settings map.',
      z.record(z.string(), z.string()),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings',
  tags: [TAG],
  summary: 'Upsert one or more settings.',
  operationId: 'settings.update',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.SettingsBody } },
    },
  },
  responses: {
    200: inlineJsonResponse('Settings updated.', z.record(z.string(), z.string())),
    ...commonErrorResponses,
  },
})
