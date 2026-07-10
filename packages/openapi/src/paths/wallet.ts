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

const TAG = 'Wallet'

const walletAddressSchema = z
  .object({
    username: z.string(),
    mode: z.enum(['IDLE', 'ALIAS', 'CUSTOM_NWC', 'DEFAULT_NWC']),
    redirect: z.string().nullable().optional(),
    remoteWalletId: z.string().nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .passthrough()
  .openapi({ description: 'Per-user wallet lightning address record.' })

const walletAliasProbeCheckSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
})

const walletAliasProbeResultSchema = z.object({
  address: z.string(),
  canSave: z.boolean(),
  checks: z.object({
    lud16: walletAliasProbeCheckSchema,
    lud21: walletAliasProbeCheckSchema,
    nip57: walletAliasProbeCheckSchema,
  }),
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/addresses',
  tags: [TAG],
  summary: 'List the caller’s wallet addresses.',
  operationId: 'wallet.addresses.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Addresses.', z.object({ data: z.array(walletAddressSchema) })),
    ...commonErrorResponses,
  },
})

const walletCardSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    pubkey: z.string().optional(),
    username: z.string().optional(),
    remoteWalletId: z.string().nullable().optional(),
    kind: z.enum(['SIMPLE', 'MASTER']).optional(),
  })
  .passthrough()
  .openapi({
    description:
      'A card paired to the caller. Never includes NTAG424 keys (only the ' +
      'public `cid`/`ctr` on `ntag424`).',
  })

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/cards',
  tags: [TAG],
  summary: 'List the cards paired to the caller.',
  description:
    'Returns only the cards paired to the authenticated user (`Card.userId === ' +
    'caller`). ANY authenticated role can read their own cards — unlike the ' +
    'admin-scoped `/api/cards` (gated on `CARDS_READ`), which returns every ' +
    'card. Powers the per-user Cards view and the Connection Map. Never returns ' +
    'NTAG424 keys.',
  operationId: 'wallet.cards.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Cards.', z.array(walletCardSchema)),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/wallet/cards/{id}',
  tags: [TAG],
  summary: 'Update one of the caller’s cards.',
  description:
    'Enables or disables an owner-scoped card, or binds it to the caller’s active primary remote wallet. Blocked cards cannot be updated.',
  operationId: 'wallet.cards.update',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.WalletCardUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Card updated.', walletCardSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/addresses',
  tags: [TAG],
  summary: 'Create a wallet address for the caller.',
  operationId: 'wallet.addresses.create',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.WalletAddressCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Address created.', walletAddressSchema),
    ...commonErrorResponses,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/addresses/alias-probe',
  tags: [TAG],
  summary: 'Probe a Lightning Address before using it as an alias.',
  description:
    'Checks LUD-16 reachability and reports optional LUD-21 and NIP-57 capabilities. LUD-16 support determines whether the alias can be saved.',
  operationId: 'wallet.addresses.probeAlias',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.WalletAliasProbeRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Alias capabilities.', walletAliasProbeResultSchema),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/addresses/{username}',
  tags: [TAG],
  summary: 'Get a wallet address by username.',
  operationId: 'wallet.addresses.get',
  security: protectedSecurity,
  request: { params: schemas.WalletAddressUsernameParam },
  responses: {
    200: inlineJsonResponse('Address.', walletAddressSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/wallet/addresses/{username}',
  tags: [TAG],
  summary: 'Update a wallet address (mode, redirect, NWC connection).',
  operationId: 'wallet.addresses.update',
  security: protectedSecurity,
  request: {
    params: schemas.WalletAddressUsernameParam,
    body: {
      content: { 'application/json': { schema: schemas.WalletAddressUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Address updated.', walletAddressSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/wallet/addresses/{username}',
  tags: [TAG],
  summary: 'Delete one of the caller’s own wallet addresses.',
  operationId: 'wallet.addresses.delete',
  security: protectedSecurity,
  request: { params: schemas.WalletAddressUsernameParam },
  responses: {
    200: inlineJsonResponse(
      'Address deleted.',
      z.object({ success: z.literal(true), username: z.string() }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/addresses/{username}/primary',
  tags: [TAG],
  summary: 'Set this wallet address as the caller’s primary.',
  operationId: 'wallet.addresses.setPrimary',
  security: protectedSecurity,
  request: { params: schemas.WalletAddressUsernameParam },
  responses: {
    200: inlineJsonResponse('Primary set.', z.object({ success: z.literal(true) })),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/addresses/{username}/invoices',
  tags: [TAG],
  summary: 'List invoices associated with a wallet address.',
  operationId: 'wallet.addresses.invoices',
  security: protectedSecurity,
  request: { params: schemas.WalletAddressUsernameParam },
  responses: {
    200: inlineJsonResponse(
      'Invoices.',
      z.object({ data: z.array(z.object({}).passthrough()) }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})
