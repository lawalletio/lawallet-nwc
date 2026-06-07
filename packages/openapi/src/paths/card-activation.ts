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

const TAG = 'Card Activation'

const qrKind = z.enum(['ONE_TIME', 'FOREVER'])
const tokenStatus = z.enum(['PENDING', 'CLAIMED', 'REVOKED', 'EXPIRED'])

const mintedToken = z
  .object({
    tokenId: z.string(),
    qrPayload: z.string().url(),
    qrKind,
    expiresAt: z.string().datetime().nullable(),
  })
  .openapi({ description: 'A freshly minted activation token + its scannable QR payload.' })

const activeToken = z
  .object({
    tokenId: z.string(),
    qrKind,
    qrPayload: z.string().url(),
    status: tokenStatus,
    expiresAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi({ description: 'An active (PENDING, unexpired) activation token for a card.' })

const tokenPreview = z
  .object({
    tokenId: z.string(),
    qrKind,
    status: tokenStatus,
    card: z.object({
      id: z.string(),
      title: z.string().optional(),
      kind: z.enum(['SIMPLE', 'MASTER']),
      design: z.object({
        id: z.string(),
        imageUrl: z.string(),
        description: z.string(),
      }),
    }),
  })
  .openapi({ description: 'Public, secret-free preview of an activation token for the wallet scanner.' })

const claimResult = z
  .object({
    qrKind: z.literal('ONE_TIME'),
    card: z
      .object({
        id: z.string(),
        kind: z.enum(['SIMPLE', 'MASTER']),
        remoteWalletId: z.string().nullable(),
      })
      .passthrough(),
  })
  .openapi({ description: 'Result of a ONE_TIME claim — ownership transferred, token burned.' })

// POST /api/cards/{id}/activation-tokens — mint an activation QR (operator).
registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/activation-tokens',
  tags: [TAG],
  summary: 'Mint an activation QR for a card.',
  description:
    'Issues a ONE_TIME activation token (FOREVER is reserved for the future MASTER account-share feature and is rejected). Replaces any prior active token of the same kind.',
  operationId: 'cards.activationTokens.create',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.ActivationTokenCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Activation token minted.', mintedToken),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

// GET /api/cards/{id}/activation-tokens — list active tokens (viewer).
registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/cards/{id}/activation-tokens',
  tags: [TAG],
  summary: "List a card's active activation tokens.",
  operationId: 'cards.activationTokens.list',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Active activation tokens.', z.array(activeToken)),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

// POST /api/cards/{id}/rescue — reset + re-issue (operator).
registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/rescue',
  tags: [TAG],
  summary: 'Rescue a card — revoke outstanding tokens and re-issue a fresh ONE_TIME QR.',
  description:
    'Destructive reset: revokes outstanding tokens, unassigns the card (clears holder + bound wallet), and mints a fresh ONE_TIME activation token.',
  operationId: 'cards.rescue',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    201: inlineJsonResponse('Card rescued; fresh activation token minted.', mintedToken),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

// GET /api/activation-tokens/{id} — public preview for the scanner.
registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/activation-tokens/{id}',
  tags: [TAG],
  summary: 'Preview an activation token (for the wallet scanner).',
  operationId: 'activationTokens.preview',
  security: publicSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Token preview.', tokenPreview),
    ...publicErrorResponses,
    404: responses.notFound,
  },
})

// POST /api/activation-tokens/{id}/claim — claim/transfer (any authenticated user).
registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/activation-tokens/{id}/claim',
  tags: [TAG],
  summary: 'Claim a card via its activation token.',
  description:
    'Any authenticated wallet user (NIP-98 or JWT). A ONE_TIME claim transfers the card to the claimer, binds a Remote Wallet, and burns the token. A second claim returns 409.',
  operationId: 'activationTokens.claim',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.ActivationTokenClaimRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Card claimed.', claimResult),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})
