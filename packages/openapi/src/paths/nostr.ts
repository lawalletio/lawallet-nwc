import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'

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
      .openapi({ description: 'Bypass the cache and refetch from relays.' }),
  })
  .openapi({ description: 'Batch of pubkeys to resolve kind-0 metadata for.' })

const profileEntry = z
  .object({
    pubkey: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    fetchedAt: z.string().datetime().nullable(),
  })
  .openapi({ description: 'Resolved Nostr kind-0 metadata for a registered user.' })

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
      content: { 'application/json': { schema: profileRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse(
      'Resolved profiles.',
      z.object({ profiles: z.array(profileEntry) }),
    ),
    ...commonErrorResponses,
  },
})
