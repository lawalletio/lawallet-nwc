import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { LISTENER_HMAC } from '../security'

const TAG = 'Nostr'

const profileRequest = z
  .object({
    pubkeys: z
      .array(z.string().min(1))
      .min(1)
      .max(200)
      .openapi({ description: 'Hex pubkeys to resolve (1–200).' }),
    force: z
      .boolean()
      .optional()
      .openapi({ description: 'Bypass the cache and refetch from relays.' })
  })
  .openapi({ description: 'Batch of pubkeys to resolve kind-0 metadata for.' })

const profileEntry = z
  .object({
    pubkey: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    fetchedAt: z.string().datetime().nullable()
  })
  .openapi({
    description: 'Resolved Nostr kind-0 metadata for a registered user.'
  })

// POST /api/nostr/profiles — resolve registered users' kind-0 metadata via the
// server-side cache. Unregistered pubkeys are silently omitted, so it cannot be
// used as a general-purpose relay proxy.
registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/nostr/profiles',
  tags: [TAG],
  summary: "Resolve registered users' Nostr profiles.",
  description:
    'Batch-resolves kind-0 metadata for registered users through the server-side cache. Unregistered pubkeys are omitted from the response.',
  operationId: 'nostr.profiles.resolve',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: profileRequest } }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Resolved profiles.',
      z.object({ profiles: z.array(profileEntry) })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  method: 'post',
  path: '/api/internal/zaps/settle',
  tags: [TAG],
  summary: 'Request a NIP-57 zap settlement pass.',
  description:
    'Internal listener-only endpoint. `notifications` is optional in NIP-47, so a wallet may never report a payment — this tick lets the server poll pending zap invoices with `lookup_invoice` and publish their kind:9735 receipts. The listener signs an empty JSON body with HMAC-SHA256 over `<timestamp>.<body>` and supplies x-lawallet-timestamp plus x-lawallet-signature. The body is ignored: the server selects the candidates itself. The response is immediate; the sweep runs after the response. Returns 404 when no listener is configured.',
  operationId: 'nostr.internal.zapsSettle',
  security: [{ [LISTENER_HMAC]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Settlement pass accepted.',
      z.object({ accepted: z.literal(true) })
    ),
    401: responses.unauthenticated,
    404: responses.notFound,
    500: responses.internalError
  }
})
