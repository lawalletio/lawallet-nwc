import { z } from 'zod'
import { commonErrorResponses, inlineJsonResponse, withRole } from '../helpers'
import { registry } from '../registry'
import { NIP98 } from '../security'

const TAG = 'Root'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/root/assign',
  tags: [TAG],
  summary: 'Read root pubkey assignment.',
  description: 'Authenticated via NIP-98; called during initial setup.',
  operationId: 'root.assign.get',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Root assignment status.',
      z.object({ rootPubkey: z.string().nullable().optional() }).passthrough(),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/root/assign',
  tags: [TAG],
  summary: 'Claim the root admin role (first-time bootstrap).',
  description: 'Authenticated via NIP-98 because no JWT exists yet during initial setup.',
  operationId: 'root.assign.set',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse('Root claimed.', z.object({ success: z.literal(true) })),
    ...commonErrorResponses,
  },
})
