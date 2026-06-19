import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  noContent,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Remote Wallets'

// Wire shape returned by the route handlers. Deliberately omits `config`
// (it carries secrets like the NWC URI) and `userId` (implicit from the
// authenticated caller).
const remoteWalletSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['NWC', 'LND', 'CLN', 'BTCPAY']),
    status: z.enum(['ACTIVE', 'DISABLED', 'REVOKED', 'DEAD']),
    isDefault: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    diedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: 'When an archived (DEAD) disposable wallet was detected dead; null otherwise.' }),
    provider: z
      .enum(['lncurl'])
      .nullable()
      .openapi({ description: "'lncurl' for a disposable LNCurl wallet; null for a user-supplied connection." }),
    lncurlServerUrl: z
      .string()
      .nullable()
      .openapi({ description: 'For LNCurl wallets, the server that minted this wallet; null otherwise.' }),
  })
  .openapi({ description: 'Remote wallet record. The secret `config` is never returned.' })

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets',
  tags: [TAG],
  summary: 'List the caller’s remote wallets (REVOKED hidden unless filtered by status).',
  operationId: 'remoteWallets.list',
  security: protectedSecurity,
  request: { query: schemas.RemoteWalletListQuery },
  responses: {
    200: inlineJsonResponse('Remote wallets.', z.array(remoteWalletSchema)),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets',
  tags: [TAG],
  summary: 'Create a remote wallet for the caller.',
  operationId: 'remoteWallets.create',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.RemoteWalletCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Remote wallet created.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets/lncurl',
  tags: [TAG],
  summary:
    'Provision a disposable LNCurl wallet (mints the NWC string server-side, makes it default, inherits previous bindings).',
  operationId: 'remoteWallets.createLncurl',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.RemoteWalletLncurlCreateRequest },
      },
    },
  },
  responses: {
    201: inlineJsonResponse('LNCurl wallet created.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}',
  tags: [TAG],
  summary: 'Get a remote wallet by id, scoped to the caller.',
  operationId: 'remoteWallets.get',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Remote wallet.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/remote-wallets/{id}',
  tags: [TAG],
  summary: 'Update a remote wallet (rename, flip default, change status).',
  operationId: 'remoteWallets.update',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.RemoteWalletUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Remote wallet updated.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/remote-wallets/{id}',
  tags: [TAG],
  summary: 'Revoke a remote wallet (soft delete — status flips to REVOKED).',
  operationId: 'remoteWallets.delete',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    204: noContent('Wallet revoked.'),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})
