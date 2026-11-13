import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  jsonContent,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { LISTENER_HMAC } from '../security'

const ADMIN_TAG = 'Integrations'
const WALLET_TAG = 'Cash-out'

const integrationIdSchema = z.enum(['bullbitcoin', 'wapu', 'alias'])
const swapProviderSchema = z.enum(['bullbitcoin', 'wapu'])

const integrationSchema = z
  .object({
    id: integrationIdSchema,
    name: z.string(),
    description: z.string(),
    kind: z.enum(['swap', 'lookup']),
    website: z.string(),
    fields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        secret: z.boolean().optional(),
        required: z.boolean().optional(),
        defaultValue: z.string().optional(),
        placeholder: z.string().optional(),
        help: z.string().optional()
      })
    ),
    enabled: z.boolean(),
    configured: z.boolean(),
    values: z.record(z.string(), z.string()),
    secretsConfigured: z.record(z.string(), z.boolean())
  })
  .openapi({ description: 'An integration and its admin-visible state.' })

const swapSchema = z
  .object({
    id: z.string(),
    provider: swapProviderSchema,
    externalId: z
      .string()
      .openapi({ description: 'Provider order (or matched transfer) id.' }),
    destination: z.string(),
    holderName: z.string().nullable(),
    amountArs: z.number(),
    amountSats: z.number().int(),
    bolt11: z.string(),
    paymentHash: z.string().nullable(),
    status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELED']),
    providerStatus: z.string().nullable(),
    receiptUrl: z.string().nullable(),
    expiresAt: z.string().datetime().nullable(),
    paidAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .openapi({ description: 'A Lightning → ARS cash-out order.' })

const idParams = z.object({ id: integrationIdSchema })

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'get',
  path: '/api/integrations',
  tags: [ADMIN_TAG],
  summary: 'List integrations and their configuration state.',
  description: 'Secret values are never returned, only presence flags.',
  operationId: 'integrations.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Every integration.',
      z.object({
        secretsEncrypted: z.boolean(),
        integrations: z.array(integrationSchema)
      })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'put',
  path: '/api/integrations/{id}',
  tags: [ADMIN_TAG],
  summary: 'Configure or toggle an integration.',
  operationId: 'integrations.update',
  security: protectedSecurity,
  request: {
    params: idParams,
    body: { content: jsonContent('UpdateIntegration') }
  },
  responses: {
    200: inlineJsonResponse('Saved.', z.object({ ok: z.boolean() })),
    ...commonErrorResponses,
    413: responses.payloadTooLarge
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/integrations/{id}/test',
  tags: [ADMIN_TAG],
  summary: 'Check the stored credentials against the provider.',
  operationId: 'integrations.test',
  security: protectedSecurity,
  request: { params: idParams },
  responses: {
    200: inlineJsonResponse(
      'Provider answer.',
      z.object({ ok: z.boolean(), detail: z.string() })
    ),
    ...commonErrorResponses,
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/swaps/quote',
  tags: [WALLET_TAG],
  summary: 'Quote a cash-out with every available provider.',
  description:
    'Sats each enabled provider would charge to wire `amountArs` pesos. ' +
    'Empty when no cash-out integration is enabled.',
  operationId: 'wallet.swaps.quote',
  security: protectedSecurity,
  request: { query: z.object({ amountArs: z.coerce.number().positive() }) },
  responses: {
    200: inlineJsonResponse(
      'One quote per available provider.',
      z.array(
        z.object({
          provider: swapProviderSchema,
          sats: z.number().int().nullable(),
          arsPerBtc: z.number().nullable(),
          minArs: z.number().nullable(),
          error: z.string().optional()
        })
      )
    ),
    ...commonErrorResponses,
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/swaps',
  tags: [WALLET_TAG],
  summary: 'List the caller’s cash-outs.',
  operationId: 'wallet.swaps.list',
  security: protectedSecurity,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10)
    })
  },
  responses: {
    200: inlineJsonResponse(
      'One page, newest first. Live updates arrive as the `swaps:updated` SSE event.',
      z.object({
        items: z.array(swapSchema),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int()
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/swaps',
  tags: [WALLET_TAG],
  summary: 'Create a Lightning → ARS cash-out order.',
  description:
    'Places the order with the provider using the community’s credentials ' +
    'and returns its BOLT11. The client pays it from the user’s own wallet, ' +
    'then polls `GET /api/wallet/swaps/{id}` until the bank transfer settles.',
  operationId: 'wallet.swaps.create',
  security: protectedSecurity,
  request: { body: { content: jsonContent('CreateSwap') } },
  responses: {
    201: inlineJsonResponse('Order created.', swapSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    413: responses.payloadTooLarge,
    429: responses.rateLimited,
    503: responses.serviceUnavailable
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/swaps/{id}',
  tags: [WALLET_TAG],
  summary: 'Get one of the caller’s cash-outs.',
  description:
    'Refreshes the status from the provider while pending (at most every ' +
    '10s). Another account’s swap is reported as missing.',
  operationId: 'wallet.swaps.get',
  security: protectedSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: inlineJsonResponse('The swap.', swapSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/swaps/{id}/paid',
  tags: [WALLET_TAG],
  summary: 'Record that the caller paid a cash-out invoice.',
  description:
    'Proof of payment: `sha256(preimage)` must equal the invoice payment ' +
    'hash. Sets `paidAt`, which lets status tracking tell an unpaid order ' +
    'from a bank transfer in progress. Idempotent.',
  operationId: 'wallet.swaps.paid',
  security: protectedSecurity,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ preimage: z.string().regex(/^[0-9a-f]{64}$/i) })
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse('The swap.', swapSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/swaps/{id}/cancel',
  tags: [WALLET_TAG],
  summary: 'Cancel an unpaid cash-out order.',
  description:
    'Local cancel (the providers have no cancel call): the provider is ' +
    'checked first, and 409 is returned once the order is paid or settled. ' +
    'A later valid payment proof reopens the order. Idempotent.',
  operationId: 'wallet.swaps.cancel',
  security: protectedSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: inlineJsonResponse('The canceled swap.', swapSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/alias/{query}',
  tags: [WALLET_TAG],
  summary: 'Resolve an Argentine bank alias or CBU/CVU to its owner.',
  description:
    'Proxies the Gorilla API alias integration. 404 when the integration is ' +
    'off or the account does not exist.',
  operationId: 'wallet.alias.lookup',
  security: protectedSecurity,
  request: { params: z.object({ query: z.string() }) },
  responses: {
    200: inlineJsonResponse(
      'The bank account.',
      z.object({
        cvu: z.string(),
        alias: z.string().nullable(),
        bank: z.string(),
        icon: z.string().nullable(),
        owners: z.array(
          z.object({
            type: z.enum(['F', 'J']),
            cuit: z.string(),
            name: z.string()
          })
        )
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    429: responses.rateLimited,
    503: responses.serviceUnavailable
  }
})

registry.registerPath({
  method: 'post',
  path: '/api/internal/swaps/reconcile',
  tags: [WALLET_TAG],
  summary: 'Request a cash-out swap status pass (listener cron).',
  description:
    'Internal listener-only endpoint. Refreshes every in-flight swap from its provider (Wapu / Bull Bitcoin), persists the status and pushes `swaps:updated` over SSE. The listener signs an empty JSON body with HMAC-SHA256 over `<timestamp>.<body>` and supplies x-lawallet-timestamp plus x-lawallet-signature. The body is ignored. The response is immediate (`pending` says whether any swap is still followed, so the listener can back off); the pass runs after the response. Returns 404 when no listener is configured.',
  operationId: 'wallet.internal.swapsReconcile',
  security: [{ [LISTENER_HMAC]: [] }],
  responses: {
    200: inlineJsonResponse(
      'Reconcile pass accepted.',
      z.object({
        accepted: z.literal(true),
        pending: z.boolean(),
        nextPollAt: z.string().nullable()
      })
    ),
    401: responses.unauthenticated,
    404: responses.notFound,
    500: responses.internalError
  }
})
