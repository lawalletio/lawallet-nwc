import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'
import { NIP98 } from '../security'

const TAG = 'Card Designs'

const cardDesignSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    imageUrl: z.string().url(),
    createdAt: z.string().datetime(),
    /**
     * Non-null means the design is archived. The routes expose the timestamp,
     * never a boolean — `archived: boolean` exists only on the *update request*
     * body, which the handler translates to `archivedAt = now()` / `null`.
     */
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi({ description: 'Card design template.' })

/**
 * `/get/{id}` selects a narrower column set than the other read paths — it
 * predates the archive feature and never returns `archivedAt`.
 */
const cardDesignSummarySchema = cardDesignSchema
  .omit({ archivedAt: true })
  .openapi({ description: 'Card design template (without archive state).' })

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
    // The handler returns a plain `NextResponse.json(design)` — 200, not 201.
    // No 409 either: `CardDesign.id` is `@default(uuid())` and the create call
    // never supplies one, so there is no unique-collision path.
    200: inlineJsonResponse('Card design created.', cardDesignSchema),
    ...commonErrorResponses,
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
    // Bare array — the handler returns the Prisma rows directly, not an
    // envelope.
    200: inlineJsonResponse('Card designs.', z.array(cardDesignSchema)),
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
  // Not public: the handler calls `validateAdminAuth`, which is
  // `validateRoleAuth(request, Role.ADMIN)` on top of NIP-98 only — so unlike
  // its sibling read paths it accepts no Bearer JWT.
  ...withRole('ADMIN'),
  method: 'get',
  path: '/api/card-designs/get/{id}',
  tags: [TAG],
  summary: 'Get a card design by ID (alternate path).',
  operationId: 'cardDesigns.getById',
  security: [{ [NIP98]: [] }],
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Card design.', cardDesignSummarySchema),
    ...commonErrorResponses,
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
  summary: "Import this community's card designs from veintiuno.lat.",
  description:
    'Pulls the published veintiuno.lat catalog server-side and inserts the ' +
    'designs whose `communityId` matches the configured `community_id`. Takes ' +
    'no request body. Entries whose image URL is not an http(s) URL are ' +
    'skipped. Designs that already exist are left untouched. Returns 400 when ' +
    '`is_community` / `community_id` are not configured.',
  operationId: 'cardDesigns.import',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Import result.',
      z.object({
        success: z.boolean(),
        message: z.string(),
        imported: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        // Omitted when there was nothing new to import.
        designs: z
          .array(
            z.object({
              id: z.string(),
              imageUrl: z.string().url(),
              description: z.string(),
              createdAt: z.string().datetime(),
            }),
          )
          .optional(),
      }),
    ),
    ...commonErrorResponses,
  },
})
