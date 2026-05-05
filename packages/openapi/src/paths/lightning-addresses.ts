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

const TAG = 'Lightning Addresses'

const addressSchema = z
  .object({
    username: z.string(),
    pubkey: z.string().nullable().optional(),
    domain: z.string().optional(),
  })
  .passthrough()
  .openapi({ description: 'Lightning address record.' })

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/lightning-addresses',
  tags: [TAG],
  summary: 'List lightning addresses.',
  operationId: 'lightningAddresses.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Addresses.', z.object({ data: z.array(addressSchema) })),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lightning-addresses/check',
  tags: [TAG],
  summary: 'Check whether a username is available.',
  operationId: 'lightningAddresses.check',
  security: publicSecurity,
  request: {
    query: z.object({
      username: z
        .string()
        .min(1)
        .max(16)
        .openapi({ description: 'Username candidate to check.' }),
    }),
  },
  responses: {
    200: inlineJsonResponse(
      'Availability result.',
      z.object({ available: z.boolean() }),
    ),
    ...publicErrorResponses,
  },
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/lightning-addresses/counts',
  tags: [TAG],
  summary: 'Lightning address counts.',
  operationId: 'lightningAddresses.counts',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Counts.',
      z.object({
        total: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
      }),
    ),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lightning-addresses/relays',
  tags: [TAG],
  summary: 'List relays advertised for the platform.',
  operationId: 'lightningAddresses.relays',
  security: publicSecurity,
  responses: {
    200: inlineJsonResponse(
      'Relay list.',
      z.object({ relays: z.array(z.string().url()) }),
    ),
    ...publicErrorResponses,
  },
})
