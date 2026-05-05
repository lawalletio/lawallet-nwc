import { z } from 'zod'
import { inlineJsonResponse, publicErrorResponses, publicSecurity, withRole } from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'LUD-16'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}',
  tags: [TAG],
  summary: 'LUD-16 / LUD-06 pay request lookup.',
  description:
    'Public lookup that resolves a lightning address to a LUD-06 pay request response. ' +
    'Supports LUD-12 (commentAllowed) and LUD-21 (verify field).',
  operationId: 'lud16.payRequest',
  security: publicSecurity,
  request: { params: schemas.Lud16UsernameParam },
  responses: {
    200: inlineJsonResponse(
      'Pay request.',
      z.object({}).passthrough(),
    ),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}/cb',
  tags: [TAG],
  summary: 'LUD-16 callback that returns a BOLT11 invoice.',
  operationId: 'lud16.callback',
  security: publicSecurity,
  request: {
    params: schemas.Lud16UsernameParam,
    query: schemas.Lud16CallbackQuery,
  },
  responses: {
    200: inlineJsonResponse(
      'Callback response with the BOLT11 invoice.',
      z.object({ pr: z.string() }).passthrough(),
    ),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}/verify/{paymentHash}',
  tags: [TAG],
  summary: 'LUD-21 payment verification.',
  operationId: 'lud16.verify',
  security: publicSecurity,
  request: {
    params: z.object({
      username: z.string().min(1).openapi({ description: 'Lightning address username.' }),
      paymentHash: z
        .string()
        .min(1)
        .openapi({ description: 'BOLT11 payment hash returned by /cb.' }),
    }),
  },
  responses: {
    200: inlineJsonResponse(
      'Verification status.',
      z.object({ status: z.enum(['OK', 'ERROR']) }).passthrough(),
    ),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})
