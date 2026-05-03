import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  publicErrorResponses,
  publicSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Card Designs'

const cardDesignSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    imageUrl: z.string().url(),
    archived: z.boolean(),
    createdAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .openapi({ description: 'Card design template.' })

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/card-designs',
  tags: [TAG],
  summary: 'Create a card design.',
  operationId: 'cardDesigns.create',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.CardDesignCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Card design created.', cardDesignSchema),
    ...commonErrorResponses,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/card-designs/list',
  tags: [TAG],
  summary: 'List card designs.',
  operationId: 'cardDesigns.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Card designs.',
      z.object({ data: z.array(cardDesignSchema) }),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/card-designs/count',
  tags: [TAG],
  summary: 'Count card designs.',
  operationId: 'cardDesigns.count',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Count.', z.object({ count: z.number().int().nonnegative() })),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/card-designs/get/{id}',
  tags: [TAG],
  summary: 'Get a card design by ID (alternate path).',
  operationId: 'cardDesigns.getById',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Card design.', cardDesignSchema),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'put',
  path: '/api/card-designs/{id}',
  tags: [TAG],
  summary: 'Update a card design.',
  operationId: 'cardDesigns.update',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.CardDesignUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Card design updated.', cardDesignSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/card-designs/import',
  tags: [TAG],
  summary: 'Bulk-import card designs.',
  operationId: 'cardDesigns.import',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              designs: z.array(
                z.object({
                  description: z.string(),
                  imageUrl: z.string().url(),
                }),
              ),
            })
            .openapi({ description: 'Batch payload of card designs.' }),
        },
      },
    },
  },
  responses: {
    200: inlineJsonResponse(
      'Import result.',
      z.object({ imported: z.number().int().nonnegative() }),
    ),
    ...commonErrorResponses,
  },
})
