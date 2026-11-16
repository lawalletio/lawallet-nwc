import { z } from 'zod'
import { invoiceLookupQuerySchema } from '@lawallet-nwc/shared'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
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
    'One-time bootstrap check — once an admin is assigned this endpoint is no longer relevant. ' +
    'Authenticated via NIP-98 directly so the bootstrap wizard works without a JWT.',
  operationId: 'admin.assign.get',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Assignment status.',
      z.object({ pubkey: z.string().nullable().optional() }).passthrough()
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/admin/assign',
  tags: [TAG],
  summary: 'Assign the admin role.',
  description:
    'One-time bootstrap operation — succeeds only when no admin exists. Subsequent calls are rejected. ' +
    'Authenticated via NIP-98 directly so the bootstrap wizard works without a JWT.',
  operationId: 'admin.assign.set',
  security: [{ [NIP98]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Admin assigned.',
      z.object({ success: z.literal(true) })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/admin/tools/invoice',
  tags: [TAG],
  summary: 'Look up a Lightning invoice.',
  description:
    'Verifies and decodes a bolt11 invoice, then resolves the local rows tied ' +
    'to its payment hash: an invoice minted here (owner, receiving wallet, ' +
    'status, preimage), card payments of it, and swaps paying it. For an ' +
    'invoice not minted here, `node` carries the payee node from Amboss. ' +
    'Requires `users:read`.',
  operationId: 'admin.tools.invoiceLookup',
  security: protectedSecurity,
  request: { query: invoiceLookupQuerySchema },
  responses: {
    200: inlineJsonResponse(
      'Decoded invoice and lookup results.',
      z
        .object({
          invoice: z.string(),
          decoded: z.object({}).passthrough(),
          isLocal: z.boolean(),
          local: z.object({
            invoice: z.object({}).passthrough().nullable(),
            cardPayments: z.array(z.object({}).passthrough()),
            swaps: z.array(z.object({}).passthrough())
          }),
          node: z.object({}).passthrough().nullable()
        })
        .passthrough()
    ),
    ...commonErrorResponses
  }
})
