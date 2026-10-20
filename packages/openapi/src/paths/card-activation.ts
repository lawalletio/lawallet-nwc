import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  publicErrorResponses,
  publicSecurity,
  withRole
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
    expiresAt: z.string().datetime().nullable()
  })
  .openapi({
    description: 'A freshly minted activation token + its scannable QR payload.'
  })

const activeToken = z
  .object({
    tokenId: z.string(),
    qrKind,
    qrPayload: z.string().url(),
    status: tokenStatus,
    expiresAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime()
  })
  .openapi({
    description: 'An active (PENDING, unexpired) activation token for a card.'
  })

const purpose = z.enum(['ACTIVATE', 'RECOVER'])

const tokenPreview = z
  .object({
    tokenId: z.string(),
    qrKind,
    purpose,
    status: tokenStatus,
    card: z.object({
      id: z.string(),
      title: z.string().optional(),
      kind: z.enum(['SIMPLE', 'MASTER']),
      design: z.object({
        id: z.string(),
        imageUrl: z.string(),
        description: z.string()
      })
    })
  })
  .openapi({
    description:
      'Public, secret-free preview of an activation token for the wallet scanner.'
  })

const claimResult = z
  .object({
    qrKind: z.literal('ONE_TIME'),
    card: z
      .object({
        id: z.string(),
        kind: z.enum(['SIMPLE', 'MASTER']),
        remoteWalletId: z.string().nullable()
      })
      .passthrough(),
    bonuses: z.object({
      freeLightningAddress: z.boolean(),
      sats: z.object({
        granted: z.boolean(),
        amountSats: z.number().int().optional()
      })
    }),
    needsLightningAddress: z.boolean()
  })
  .openapi({
    description:
      'Result of a ONE_TIME claim — ownership transferred, token burned, first-activation bonuses reserved.'
  })

const recoveryClaimResult = z
  .object({
    qrKind: z.literal('ONE_TIME'),
    purpose: z.literal('RECOVER'),
    outcome: z.enum(['recovered', 'same-account']),
    recovery: z
      .object({
        lightningAddresses: z.array(z.string()),
        primaryAddress: z.string().nullable(),
        cards: z.array(
          z.object({
            id: z.string(),
            title: z.string().nullable(),
            designImageUrl: z.string().nullable()
          })
        ),
        remoteWallets: z.array(
          z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })
        ),
        vouchers: z.number().int(),
        mergedIntoExisting: z.boolean()
      })
      .optional(),
    needsLightningAddress: z.boolean().optional()
  })
  .openapi({
    description:
      'Result of claiming a RECOVER token: the card holder’s whole account moved onto the claimer (`recovered`), or the claimer already owns the card and the QR was revoked (`same-account`).'
  })

const recoveryMinted = mintedToken.extend({ purpose: z.literal('RECOVER') })

const recoverySide = z.object({
  lightningAddresses: z.array(z.string()),
  cards: z.number().int(),
  remoteWallets: z.number().int()
})

const recoveryCheck = z
  .object({
    sameAccount: z.boolean(),
    mergeRequired: z.boolean(),
    existing: recoverySide,
    incoming: recoverySide
  })
  .openapi({
    description:
      'Pre-flight for a RECOVER QR: whether the caller owns the card already, and whether their account has data that the recovery would merge into.'
  })

const cardOwner = z
  .object({
    owned: z.boolean(),
    cardDisabled: z.boolean(),
    pubkey: z.string().optional(),
    primaryAddress: z.string().nullable().optional(),
    lightningAddresses: z.array(z.string()).optional(),
    cards: z.number().int().optional(),
    remoteWallets: z.number().int().optional(),
    cardRecoveryEnabled: z.boolean().optional(),
    balanceSats: z.number().int().nullable().optional()
  })
  .openapi({
    description:
      'Who holds a card, for the card-manager POS: lightning addresses on the LUD-16 domain, live balance (null when unreachable), and whether the holder allows card recovery.'
  })

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
      content: {
        'application/json': { schema: schemas.ActivationTokenCreateRequest }
      }
    }
  },
  responses: {
    201: inlineJsonResponse('Activation token minted.', mintedToken),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
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
    404: responses.notFound
  }
})

// POST /api/cards/{id}/rescue — reset + re-issue (operator).
registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/rescue',
  tags: [TAG],
  summary:
    'Rescue a card — revoke outstanding tokens and re-issue a fresh ONE_TIME QR.',
  description:
    'Destructive reset: revokes outstanding tokens, unassigns the card (clears holder + bound wallet), and mints a fresh ONE_TIME activation token.',
  operationId: 'cards.rescue',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    201: inlineJsonResponse(
      'Card rescued; fresh activation token minted.',
      mintedToken
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
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
    404: responses.notFound
  }
})

// POST /api/activation-tokens/{id}/claim — claim/transfer (any authenticated user).
registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/activation-tokens/{id}/claim',
  tags: [TAG],
  summary: 'Claim a card via its activation token.',
  description:
    'Any authenticated wallet user (NIP-98 or JWT). A ONE_TIME claim transfers the card to the claimer, binds a Remote Wallet (creating an LNCurl wallet when the claimer has none), reserves first-activation bonuses, and burns the token. A second claim returns 409. A RECOVER-purpose token instead moves the card holder’s whole account onto the claimer; when the claimer already has data it needs `confirmMerge: true` (else 409 with `details.reason = RECOVERY_MERGE_REQUIRED`).',
  operationId: 'activationTokens.claim',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': { schema: schemas.ActivationTokenClaimRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Card claimed (or account recovered).',
      z.union([claimResult, recoveryClaimResult])
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

// GET /api/activation-tokens/{id}/recovery-check — pre-flight before a RECOVER claim.
registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/activation-tokens/{id}/recovery-check',
  tags: [TAG],
  summary: 'Check what claiming a RECOVER QR would do for the caller.',
  operationId: 'activationTokens.recoveryCheck',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Recovery pre-flight.', recoveryCheck),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

// POST /api/cards/{id}/recovery-tokens — mint a RECOVER QR (operator, physical tap).
registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'post',
  path: '/api/cards/{id}/recovery-tokens',
  tags: [TAG],
  summary: 'Mint a RECOVER QR that hands the card holder’s account over.',
  description:
    'Requires the SUN params from a fresh physical tap, verified and burned server-side. Refused when the card has no owner, is blocked or paused (409), or the owner turned card recovery off (403). The QR (activation URL tagged `?tag=recover`) expires after 15 minutes and supersedes any outstanding activation QR for the card.',
  operationId: 'cards.recoveryTokens.create',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': { schema: schemas.RecoveryTokenCreateRequest }
      }
    }
  },
  responses: {
    201: inlineJsonResponse('Recovery token minted.', recoveryMinted),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

// GET /api/cards/{id}/owner — holder summary for the card-manager POS.
registry.registerPath({
  ...withRole('OPERATOR'),
  method: 'get',
  path: '/api/cards/{id}/owner',
  tags: [TAG],
  summary: 'Show who holds a card, with their balance.',
  operationId: 'cards.owner',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Card holder summary.', cardOwner),
    ...commonErrorResponses,
    404: responses.notFound
  }
})
