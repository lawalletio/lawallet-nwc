import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'
import { LISTENER_HMAC } from '../security'

const TAG = 'LUD-16 Proxy'

const proxyStatusSchema = z.enum([
  'PENDING_INBOUND',
  'READY_TO_FORWARD',
  'FORWARDING',
  'RECEIPT_PENDING',
  'BLOCKED',
  'COMPLETED',
  'EXPIRED'
])

const proxyConfigResponseSchema = z.object({
  enabled: z.boolean(),
  feeBps: z.number().int().nonnegative(),
  walletId: z.string(),
  hasNwc: z.boolean(),
  hasReceiptNsec: z.boolean(),
  receiptPubkey: z.string().nullable(),
  vaultConfigured: z.boolean().optional(),
  listenerEnabled: z.boolean().optional(),
  outstandingPayments: z.number().int().nonnegative().optional(),
  capabilities: z
    .object({
      methods: z.array(z.string()).optional(),
      notifications: z.array(z.string()).optional()
    })
    .passthrough()
    .nullable()
    .optional(),
  balanceMsats: z.string().nullable().optional(),
  lastProbeAt: z.string().datetime().nullable().optional(),
  lastProbeError: z.string().nullable().optional(),
  lastListenerSeenAt: z.string().datetime().nullable().optional(),
  lastCronAt: z.string().datetime().nullable().optional()
})

const proxyUpdateRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    feeBps: z.number().int().min(0).max(1_000).optional(),
    nwcUri: z.string().max(8192).optional().openapi({
      description:
        'Write-only proxy NWC connection URI. An empty string clears it when no settlements are outstanding.'
    }),
    receiptNsec: z.string().max(256).optional().openapi({
      description:
        'Write-only NIP-57 receipt signer as nsec or 64-character hex. A random signer is generated during installation; supplying this field rotates it. It is encrypted at rest and never returned.'
    })
  })
  .openapi({
    description:
      'Partial proxy configuration update. At least one field is required. Credential removal or rotation is blocked while settlements are outstanding.'
  })

const proxyAttemptSchema = z.object({
  bolt11: z.string(),
  attemptNo: z.number().int().positive(),
  status: z.string(),
  paymentHash: z.string(),
  expiresAt: z.string().datetime(),
  error: z.string().nullable()
})

const proxyPaymentSchema = z.object({
  id: z.string(),
  username: z.string(),
  destination: z.string(),
  status: proxyStatusSchema,
  grossAmountMsats: z.string(),
  serviceFeeMsats: z.string(),
  destinationAmountMsats: z.string(),
  routingFeeMsats: z.string().nullable(),
  sourceStatus: z.string(),
  sourcePaymentHash: z.string(),
  sourcePaidAt: z.string().datetime().nullable(),
  forwardedAt: z.string().datetime().nullable(),
  receiptPublishedAt: z.string().datetime().nullable(),
  retryCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().datetime(),
  lastError: z.string().nullable(),
  currentAttempt: proxyAttemptSchema.nullable(),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/settings/lud16-proxy',
  tags: [TAG],
  summary: 'Read deferred Lightning Address proxy configuration and health.',
  description:
    'Returns write-only credential presence flags, fee configuration, listener/vault readiness, balance, capability probe results, and outstanding settlement count. Secret values are never returned.',
  operationId: 'lud16Proxy.config.get',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Proxy configuration and health.',
      proxyConfigResponseSchema
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'put',
  path: '/api/settings/lud16-proxy',
  tags: [TAG],
  summary: 'Update deferred Lightning Address proxy configuration.',
  description:
    'Stores the NWC URI and rotates the automatically generated NIP-57 receipt signer as write-only encrypted settings. Enabling requires a configured vault, listener, NWC connection, and receipt signer.',
  operationId: 'lud16Proxy.config.update',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: proxyUpdateRequestSchema }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Updated non-secret proxy configuration.',
      proxyConfigResponseSchema
    ),
    ...commonErrorResponses,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings/lud16-proxy/test',
  tags: [TAG],
  summary: 'Probe proxy NWC capabilities and balance.',
  description:
    'Tests the saved write-only NWC connection. The proxy requires make_invoice, pay_invoice, lookup_invoice, and get_balance.',
  operationId: 'lud16Proxy.config.test',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Capability test result. HTTP 200 may contain `ok: false` for an upstream probe failure.',
      z.object({
        ok: z.boolean(),
        balanceMsats: z.number().int().nonnegative().optional(),
        methods: z.array(z.string()).optional(),
        notifications: z.array(z.string()).optional(),
        missingMethods: z.array(z.string()).optional(),
        error: z.string().optional()
      })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/settings/lud16-proxy/payments',
  tags: [TAG],
  summary: 'List the deferred settlement queue.',
  description:
    'Returns up to 100 recent proxy payments, including gross amount, retained fee, destination amount, routing fee, current destination invoice attempt, retry timing, and errors.',
  operationId: 'lud16Proxy.payments.list',
  security: protectedSecurity,
  request: {
    query: z.object({
      status: proxyStatusSchema.optional()
    })
  },
  responses: {
    200: inlineJsonResponse(
      'Proxy settlement queue.',
      z.object({ payments: z.array(proxyPaymentSchema) })
    ),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings/lud16-proxy/payments/{id}/retry',
  tags: [TAG],
  summary: 'Wake reconciliation for one proxy payment.',
  description:
    'Clears retry timing for an eligible, unleased payment and schedules reconciliation. It does not bypass worker leases or create a competing destination invoice.',
  operationId: 'lud16Proxy.payments.retry',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse(
      'Retry accepted.',
      z.object({ accepted: z.literal(true), id: z.string() })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  method: 'post',
  path: '/api/internal/lud16-proxy/reconcile',
  tags: [TAG],
  summary: 'Request a bounded deferred-settlement reconciliation pass.',
  description:
    'Internal listener-only endpoint. The listener signs the exact raw body with HMAC-SHA256 over `<timestamp>.<body>` and supplies x-lawallet-timestamp plus x-lawallet-signature. The response is immediate; reconciliation runs after the response.',
  operationId: 'lud16Proxy.internal.reconcile',
  security: [{ [LISTENER_HMAC]: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            settlementIds: z.array(z.string().min(1)).max(10).optional()
          })
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Reconciliation request accepted.',
      z.object({ accepted: z.literal(true) })
    ),
    400: responses.validation,
    401: responses.unauthenticated,
    404: responses.notFound,
    500: responses.internalError
  }
})
