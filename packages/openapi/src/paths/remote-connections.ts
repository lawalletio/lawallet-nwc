import { z } from 'zod'
import {
  inlineJsonResponse,
  publicErrorResponses,
  publicSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Remote Connections'

// Auth here is "key-in-URL" — the externalDeviceKey acts as a shared secret
// matched against the platform Settings store. There's no Role/JWT/NIP-98
// involved, so we mark these as PUBLIC even though they're not anonymous.
registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/remote-connections/{externalDeviceKey}',
  tags: [TAG],
  summary: 'Bootstrap metadata for a remote device (auth via shared device key).',
  operationId: 'remoteConnections.get',
  security: publicSecurity,
  request: { params: schemas.ExternalDeviceKeyParam },
  responses: {
    200: inlineJsonResponse(
      'Remote device metadata.',
      z.object({}).passthrough(),
    ),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/remote-connections/{externalDeviceKey}/cards',
  tags: [TAG],
  summary: 'Initialize a card from a remote device (auth via shared device key).',
  operationId: 'remoteConnections.cards.create',
  security: publicSecurity,
  request: {
    params: schemas.ExternalDeviceKeyParam,
    body: {
      content: { 'application/json': { schema: schemas.RemoteCardCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse(
      'Remote card initialized.',
      z.object({ id: z.string() }).passthrough(),
    ),
    ...publicErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})
