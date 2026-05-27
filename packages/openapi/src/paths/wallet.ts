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
