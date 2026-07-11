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
import { errorResponse, responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Cards'

const cardSchema = z
  .object({
    id: z.string(),
    designId: z.string().nullable().optional(),
    paired: z.boolean(),
    used: z.boolean(),
    blocked: z
      .boolean()
      .optional()
      .openapi({
        description:
          'True once the card’s reset (wipe) keys were exported — ' +
          'decommissioned and pending delete; can no longer be re-used.',
      }),
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
  description:
    'Provisions a card and its NTAG424 key material. The request `id` is the card ' +
    'UID (4- or 7-byte hex, colons optional); it is normalized to uppercase hex and ' +
    'stored as the NTAG424 primary key, so a UID can back at most one card. Submitting ' +
    'a UID that already exists returns **409 Conflict** (`error.code` = `CONFLICT`) ' +
    'rather than a 500 — the same is true for a `MASTER`/`SIMPLE` card on a re-used UID.',
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
    409: errorResponse(
      'A card with the supplied UID already exists. The error envelope carries ' +
        '`error.code` = `CONFLICT` and `error.message` = ' +
        '`A card with UID <uid> already exists`.',
    ),
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
        blocked: z.number().int().nonnegative(),
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
  description:
    'Returns the card keys so a programming device can write them. **Requires a ' +
    'single-use `token`** minted by `POST /api/cards/{id}/write-token`: the token ' +
    'is valid only while the card is still fresh (never tapped) and is consumed by ' +
    'this request, so the URL cannot be replayed to re-extract the keys. Requests ' +
    'without a valid/unexpired token, or for a card that has already been tapped, ' +
    'return **403**. **Side effect:** exporting the keys unpairs the card from any ' +
    'user (holder, lightning address, and bound wallet are cleared).',
  operationId: 'cards.write',
  security: publicSecurity,
  request: {
    params: schemas.IdParam,
    query: z
      .object({
        token: z
          .string()
          .openapi({ description: 'Single-use programming token from /write-token.' }),
      })
      .openapi('CardWriteQuery'),
  },
  responses: {
    200: cardSecretsResponse,
    ...publicErrorResponses,
    403: errorResponse(
      'Missing, invalid, expired, or already-consumed programming token, or the ' +
        'card has already been tapped.',
    ),
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/write-token',
  tags: [TAG],
  summary: 'Mint a single-use BoltCard programming URL.',
  description:
    'Mints a fresh, replay-protected `GET /api/cards/{id}/write?token=…` URL for the ' +
    'admin BoltCard QR. Allowed only while the card is still fresh (never tapped); a ' +
    'card already in use returns **409** and cannot be re-programmed. Each call ' +
    'replaces any outstanding token, so re-opening the modal invalidates the previous ' +
    'QR. Gated to `CARDS_WRITE`.',
  operationId: 'cards.writeToken',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse(
      'Tokenized programming URL.',
      z
        .object({
          token: z.string(),
          url: z.string().url(),
          expiresAt: z.string().datetime(),
        })
        .openapi({
          description:
            'Single-use /write URL + its expiry. `token` is also returned raw so ' +
            'a client on a different host than the public domain can build its ' +
            'own `<base>/api/cards/{id}/write?token=…` URL.',
        }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: errorResponse(
      'The card has already been tapped and can no longer be programmed.',
    ),
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

const cardWipeResponse = inlineJsonResponse(
  'NTAG424 reset payload for NFC programming.',
  z
    .object({
      action: z.literal('wipe'),
      k0: z.string(),
      k1: z.string(),
      k2: z.string(),
      k3: z.string(),
      k4: z.string(),
      uid: z.string(),
      version: z.literal(1),
    })
    .openapi({
      description:
        'BoltCard wipe payload: the current keys + UID a programming device uses to reset the card to factory defaults.',
    }),
)

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/{id}/wipe',
  tags: [TAG],
  summary: 'Get NTAG424 reset payload for an admin programming device.',
  description:
    'Returns the card keys so a programming device can reset the NTAG424 to factory ' +
    'defaults. **Side effect:** exporting the keys unpairs the card from any user ' +
    '(holder, lightning address, and bound wallet are cleared). Idempotent.',
  operationId: 'cards.wipe',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: cardWipeResponse,
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'options',
  path: '/api/cards/{id}/wipe',
  tags: [TAG],
  summary: 'CORS preflight for /api/cards/{id}/wipe.',
  operationId: 'cards.wipe.options',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: { 204: noContent('Preflight OK.') },
})

registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/emulate-tap',
  tags: [TAG],
  summary: 'Sign a simulated NTAG424 tap (admin card emulator).',
  description:
    'Server-side SUN signing for the admin card emulator. Returns the public `p`/`c` ' +
    'params for the card’s next counter so a tap can be replayed through the scan flow ' +
    '— the NTAG424 keys never leave the server. Does not export keys, so it does not ' +
    'unpair the card.',
  operationId: 'cards.emulateTap',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse(
      'Signed tap params.',
      z
        .object({
          p: z.string(),
          c: z.string(),
          ctr: z.number().int(),
        })
        .openapi({ description: 'Public SUN params (no keys).' }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

// Public card status, returned by /scan when `x-request-action: info` is set
// (instead of the LNURL withdraw request). Non-sensitive only.
const cardInfoSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    kind: z.enum(['SIMPLE', 'MASTER']),
    paired: z.boolean(),
    used: z.boolean(),
    blocked: z.boolean(),
    design: z
      .object({
        description: z.string().nullable(),
        imageUrl: z.string().nullable(),
      })
      .nullable(),
    user: z
      .object({ pubkey: z.string(), username: z.string().nullable() })
      .nullable(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi({ description: 'Non-sensitive card status (no keys/OTC/SUN params).' })

const lnurlScanSchema = z
  .object({
    callback: z.string().url(),
    k1: z.string(),
    maxWithdrawable: z.number().int(),
    minWithdrawable: z.number().int(),
    defaultDescription: z.string(),
    tag: z.literal('withdrawRequest'),
  })
  .passthrough()

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/cards/{id}/scan',
  tags: [TAG],
  summary: 'Resolve a scanned card and return the LNURL-withdraw flow entry point.',
  description:
    'The first LNURL request on tap. Send the request header `x-request-action: info` ' +
    'to get the card’s public status JSON (design, image, owner, paired/used) instead ' +
    'of the LNURL withdraw request — so a client can show the card identity without ' +
    'running the withdraw flow. Non-sensitive only (never keys/OTC/SUN params).',
  operationId: 'cards.scan',
  security: publicSecurity,
  request: { params: schemas.IdParam, query: schemas.ScanCardQuery },
  responses: {
    200: inlineJsonResponse(
      'LNURL withdraw request, or the card status JSON when `x-request-action: info`.',
      z.union([lnurlScanSchema, cardInfoSchema]),
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
  summary: 'LNURL-withdraw callback for a scanned card.',
  operationId: 'cards.scan.callback',
  security: publicSecurity,
  request: { params: schemas.IdParam, query: schemas.CardScanCallbackQuery },
  responses: {
    200: inlineJsonResponse(
      'LUD-03 callback response.',
      z.union([
        z.object({ status: z.literal('OK') }),
        z.object({ status: z.literal('ERROR'), reason: z.string() }),
      ]),
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
