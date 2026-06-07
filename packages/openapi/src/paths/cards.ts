import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  noContent,
  protectedSecurity,
  publicErrorResponses,
  publicSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Cards'

const cardSchema = z
  .object({
    id: z.string(),
    designId: z.string().nullable().optional(),
    paired: z.boolean(),
    used: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .openapi({ description: 'Card resource as returned by /api/cards endpoints.' })

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/cards',
  tags: [TAG],
  summary: 'List cards.',
  operationId: 'cards.list',
  security: protectedSecurity,
  request: { query: schemas.CardListQuery },
  responses: {
    200: inlineJsonResponse(
      'Paginated list of cards.',
      z.object({ data: z.array(cardSchema) }),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards',
  tags: [TAG],
  summary: 'Create a card.',
  operationId: 'cards.create',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.CardCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Card created.', cardSchema),
    ...commonErrorResponses,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/cards/counts',
  tags: [TAG],
  summary: 'Count cards by status.',
  operationId: 'cards.counts',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Card counts.',
      z.object({
        total: z.number().int().nonnegative(),
        paired: z.number().int().nonnegative(),
        used: z.number().int().nonnegative(),
      }),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/cards/{id}',
  tags: [TAG],
  summary: 'Get a card by ID.',
  operationId: 'cards.get',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Card detail.', cardSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'delete',
  path: '/api/cards/{id}',
  tags: [TAG],
  summary: 'Delete a card.',
  operationId: 'cards.delete',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    204: noContent('Card deleted.'),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

const cardSecretsResponse = inlineJsonResponse(
  'NTAG424 secrets and write payload for NFC programming.',
  z
    .object({
      id: z.string(),
      keys: z.object({
        k0: z.string(),
        k1: z.string(),
        k2: z.string(),
        k3: z.string(),
        k4: z.string(),
      }),
      endpoint: z.string().url(),
    })
    .openapi({ description: 'Card programming payload returned to the writer device.' }),
)

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/{id}/write',
  tags: [TAG],
  summary: 'Get NTAG424 write payload for an admin programming device.',
  operationId: 'cards.write',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: cardSecretsResponse,
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'options',
  path: '/api/cards/{id}/write',
  tags: [TAG],
  summary: 'CORS preflight for /api/cards/{id}/write.',
  operationId: 'cards.write.options',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: { 204: noContent('Preflight OK.') },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/{id}/scan',
  tags: [TAG],
  summary: 'Resolve a scanned card and return the LNURL-pay flow entry point.',
  operationId: 'cards.scan',
  security: publicSecurity,
  request: { params: schemas.IdParam, query: schemas.ScanCardQuery },
  responses: {
    200: inlineJsonResponse(
      'LNURL-pay request.',
      z
        .object({
          callback: z.string().url(),
          maxSendable: z.number().int(),
          minSendable: z.number().int(),
          metadata: z.string(),
          tag: z.literal('payRequest'),
        })
        .passthrough(),
    ),
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'options',
  path: '/api/cards/{id}/scan',
  tags: [TAG],
  summary: 'CORS preflight for /api/cards/{id}/scan.',
  operationId: 'cards.scan.options',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: { 204: noContent('Preflight OK.') },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/{id}/scan/cb',
  tags: [TAG],
  summary: 'LNURL-pay callback for a scanned card.',
  operationId: 'cards.scan.callback',
  security: publicSecurity,
  request: { params: schemas.IdParam, query: schemas.PayActionQuery },
  responses: {
    200: inlineJsonResponse(
      'LNURL-pay callback response.',
      z.object({ pr: z.string() }).passthrough(),
    ),
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/otc/{otc}',
  tags: [TAG],
  summary: 'Resolve an OTC (one-time code) to its provisional card.',
  operationId: 'cards.otc.get',
  security: publicSecurity,
  request: { params: schemas.OtcParam },
  responses: {
    200: inlineJsonResponse('OTC payload.', z.object({}).passthrough()),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/cards/otc/{otc}/activate',
  tags: [TAG],
  summary: 'Activate a card by OTC.',
  operationId: 'cards.otc.activate',
  security: protectedSecurity,
  request: { params: schemas.OtcParam },
  responses: {
    200: inlineJsonResponse(
      'Card activated.',
      z.object({ success: z.literal(true) }).passthrough(),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})
