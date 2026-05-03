import { z } from 'zod'
import { commonErrorResponses, inlineJsonResponse, withRole } from '../helpers'
import { registry } from '../registry'
import { NIP98 } from '../security'

const TAG = 'Admin'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/admin/assign',
  tags: [TAG],
  summary: 'Read admin-assignment status.',
  description:
    'Authenticated via NIP-98 directly so the bootstrap wizard works without a JWT.',
  operationId: 'admin.assign.get',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Assignment status.',
      z.object({ pubkey: z.string().nullable().optional() }).passthrough(),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/admin/assign',
  tags: [TAG],
  summary: 'Assign the admin role.',
  description:
    'Authenticated via NIP-98 directly so the bootstrap wizard works without a JWT.',
  operationId: 'admin.assign.set',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse('Admin assigned.', z.object({ success: z.literal(true) })),
    ...commonErrorResponses,
  },
})
