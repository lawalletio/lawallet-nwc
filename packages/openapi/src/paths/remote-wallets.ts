import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  noContent,
  protectedSecurity,
  withRole
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
    diedAt: z.string().datetime().nullable().openapi({
      description:
        'When an archived (DEAD) disposable wallet was detected dead; null otherwise.'
    }),
    provider: z.enum(['lncurl']).nullable().openapi({
      description:
        "'lncurl' for a disposable LNCurl wallet; null for a user-supplied connection."
    }),
    lncurlServerUrl: z.string().nullable().openapi({
      description:
        'For LNCurl wallets, the server that minted this wallet; null otherwise.'
    })
  })
  .openapi({
    description: 'Remote wallet record. The secret `config` is never returned.'
  })

const destinationSchema = z.object({
  address: z.string(),
  allocationBps: z.number().int()
})

const receiveActionSchema = z.object({
  walletId: z.string(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
  configured: z.boolean(),
  enabled: z.boolean(),
  enabledAt: z.string().datetime().nullable(),
  pausedAt: z.string().datetime().nullable(),
  pendingReceipts: z.number().int(),
  pendingAmountMsats: z.number().int(),
  attemptInProgress: z.boolean(),
  routingReserveBps: z.number().int(),
  routingReserveBaseSats: z.number().int(),
  revision: z
    .object({
      number: z.number().int(),
      feeBps: z.number().int(),
      baseFeeSats: z.number(),
      destinations: z.array(destinationSchema)
    })
    .nullable()
})

const attemptSchema = z.object({
  id: z.string(),
  attemptNo: z.number().int(),
  bolt11: z.string(),
  paymentHash: z.string(),
  amountMsats: z.number().int(),
  requestId: z.string(),
  status: z.enum(['PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED']),
  preimage: z.string().nullable(),
  routingFeeMsats: z.number().int().nullable(),
  routingReserveMsats: z.number().int(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable()
})

const activityEntrySchema = z.object({
  id: z.string(),
  receiptId: z.string(),
  legId: z.string(),
  destination: z.string(),
  attemptNo: z.number().int(),
  amountMsats: z.number().int(),
  status: z.enum(['PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED']),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime()
})

const legSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  destination: z.string(),
  allocationBps: z.number().int(),
  requestedAmountMsats: z.number().int(),
  forwardedAmountMsats: z.number().int().nullable(),
  routingFeeMsats: z.number().int().nullable(),
  routingReserveMsats: z.number().int(),
  unusedRoutingReserveMsats: z.number().int(),
  routingFeeOverageMsats: z.number().int(),
  destinationShortfallMsats: z.number().int(),
  status: z.enum([
    'READY',
    'PENDING',
    'UNKNOWN',
    'REJECTED',
    'SUCCEEDED',
    'EXPIRED',
    'SUPERSEDED'
  ]),
  retryCount: z.number().int(),
  nextRetryAt: z.string().datetime(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  attempts: z.array(attemptSchema).optional()
})

const receiptSchema = z.object({
  id: z.string(),
  walletId: z.string(),
  eventKey: z.string(),
  sourcePaymentHash: z.string(),
  sourceInvoice: z.string().nullable(),
  grossAmountMsats: z.number().int(),
  retainedFeeMsats: z.number().int(),
  targetAmountMsats: z.number().int(),
  forwardedAmountMsats: z.number().int(),
  routingFeeMsats: z.number().int(),
  routingReserveMsats: z.number().int(),
  unusedRoutingReserveMsats: z.number().int(),
  routingFeeOverageMsats: z.number().int(),
  shortfallMsats: z.number().int(),
  configRevision: z.number().int(),
  status: z.enum([
    'RECEIVED',
    'FORWARDING',
    'PARTIAL',
    'BLOCKED',
    'COMPLETED',
    'RETAINED'
  ]),
  recovered: z.boolean(),
  sourceSettledAt: z.string().datetime(),
  lastError: z.string().nullable(),
  nextRetryAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z
    .object({
      feeBps: z.number().int(),
      baseFeeSats: z.number().int(),
      destinations: z.array(destinationSchema)
    })
    .optional(),
  legs: z.array(legSchema)
})

const notificationAttemptSchema = z.object({
  id: z.string(),
  attemptNo: z.number().int(),
  requestId: z.string(),
  status: z.enum(['PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED']),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable(),
  nostrEventId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable()
})

const notificationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  channel: z.enum(['WEBHOOK', 'NOSTR']),
  enabled: z.boolean()
})

const notificationDeliverySchema = z.object({
  id: z.string(),
  notificationId: z.string(),
  notification: notificationSummarySchema.nullable(),
  eventKey: z.string(),
  action: z.enum(['RECEIVED', 'FORWARDED']),
  payload: z.unknown(),
  status: z.enum([
    'READY',
    'PENDING',
    'UNKNOWN',
    'REJECTED',
    'SUCCEEDED',
    'EXPIRED'
  ]),
  attemptCount: z.number().int(),
  lastError: z.string().nullable(),
  nextRetryAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attempts: z.array(notificationAttemptSchema)
})

const notificationSchema = z.object({
  ...notificationSummarySchema.shape,
  action: z.enum(['RECEIVED', 'FORWARDED']),
  pausedAt: z.string().datetime().nullable(),
  webhookUrl: z.string().nullable(),
  nostrKind: z.number().int().nullable(),
  nostrRecipient: z.string().nullable(),
  nostrRelays: z.array(z.string()),
  nostrContent: z.string().nullable(),
  nip44: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deliveries: z.array(notificationDeliverySchema)
})

const zapEnvelopeSchema = z.object({
  zap: z
    .object({
      request: z.string(),
      requestJson: z.unknown(),
      receipt: z.string().nullable(),
      receiptJson: z.unknown().nullable(),
      receiptEventId: z.string().nullable(),
      receiptPublishedAt: z.string().datetime().nullable(),
      error: z.string().nullable(),
      nextRetryAt: z.string().datetime().nullable()
    })
    .nullable()
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets',
  tags: [TAG],
  summary:
    'List the caller’s remote wallets (REVOKED hidden unless filtered by status).',
  operationId: 'remoteWallets.list',
  security: protectedSecurity,
  request: { query: schemas.RemoteWalletListQuery },
  responses: {
    200: inlineJsonResponse('Remote wallets.', z.array(remoteWalletSchema)),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/receive-action',
  tags: [TAG],
  summary: 'Get the caller’s receive-forwarding action for a remote wallet.',
  operationId: 'remoteWallets.receiveAction.get',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse('Receive action.', receiveActionSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/remote-wallets/{id}/receive-action',
  tags: [TAG],
  summary: 'Create or atomically revise a receive-forwarding action.',
  operationId: 'remoteWallets.receiveAction.configure',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': {
          schema: schemas.RemoteWalletReceiveActionConfigRequest
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse('Receive action configured.', receiveActionSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/remote-wallets/{id}/receive-action',
  tags: [TAG],
  summary: 'Pause or resume a receive-forwarding action.',
  operationId: 'remoteWallets.receiveAction.toggle',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': {
          schema: schemas.RemoteWalletReceiveActionToggleRequest
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse('Receive action updated.', receiveActionSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/forwarding-activity',
  tags: [TAG],
  summary: 'List forwarding attempts and retries for the caller’s wallet.',
  operationId: 'remoteWallets.forwardingActivity.list',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    query: schemas.RemoteWalletForwardActivityListQuery
  },
  responses: {
    200: inlineJsonResponse(
      'Forwarding activity.',
      z.object({
        activity: z.array(activityEntrySchema),
        nextCursor: z.string().nullable()
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets/{id}/receive-action/force',
  tags: [TAG],
  summary:
    'Make every open receipt eligible now and wake the lease-protected forwarding worker.',
  operationId: 'remoteWallets.receiveAction.force',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    202: inlineJsonResponse(
      'Forwarding run accepted.',
      z.object({
        accepted: z.literal(true),
        forwardingReceipts: z.number().int()
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/forwarding-receipts',
  tags: [TAG],
  summary: 'List forwarding receipts for the caller’s wallet.',
  operationId: 'remoteWallets.forwardingReceipts.list',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    query: schemas.RemoteWalletForwardReceiptListQuery
  },
  responses: {
    200: inlineJsonResponse(
      'Forwarding receipts.',
      z.object({
        receipts: z.array(receiptSchema),
        nextCursor: z.string().nullable()
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/forwarding-receipts/{receiptId}',
  tags: [TAG],
  summary: 'Get a forwarding receipt with every leg and attempt.',
  operationId: 'remoteWallets.forwardingReceipts.get',
  security: protectedSecurity,
  request: { params: schemas.RemoteWalletForwardReceiptParams },
  responses: {
    200: inlineJsonResponse('Forwarding receipt.', receiptSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets/{id}/forwarding-receipts/{receiptId}/retry',
  tags: [TAG],
  summary: 'Retry all safely retryable legs or a selected subset.',
  operationId: 'remoteWallets.forwardingReceipts.retry',
  security: protectedSecurity,
  request: {
    params: schemas.RemoteWalletForwardReceiptParams,
    body: {
      content: {
        'application/json': { schema: schemas.RemoteWalletForwardRetryRequest }
      }
    }
  },
  responses: {
    202: inlineJsonResponse(
      'Retry accepted.',
      z.object({ accepted: z.literal(true), retryingLegs: z.number().int() })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/notifications',
  tags: [TAG],
  summary: 'List the caller’s outbound RemoteWallet notification channels.',
  operationId: 'remoteWallets.notifications.list',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse(
      'Notification channels and recent deliveries.',
      z.object({ notifications: z.array(notificationSchema) })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets/{id}/notifications',
  tags: [TAG],
  summary:
    'Create a webhook or Nostr notification channel for the caller’s wallet.',
  operationId: 'remoteWallets.notifications.create',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': {
          schema: schemas.RemoteWalletNotificationCreateRequest
        }
      }
    }
  },
  responses: {
    201: inlineJsonResponse(
      'Notification channel created.',
      z.object({ notifications: z.array(notificationSchema) })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/remote-wallets/{id}/notifications/{notificationId}',
  tags: [TAG],
  summary: 'Pause or resume an outbound RemoteWallet notification channel.',
  operationId: 'remoteWallets.notifications.toggle',
  security: protectedSecurity,
  request: {
    params: schemas.RemoteWalletNotificationParams,
    body: {
      content: {
        'application/json': {
          schema: schemas.RemoteWalletNotificationToggleRequest
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Notification channel updated.',
      z.object({ notifications: z.array(notificationSchema) })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/notification-deliveries',
  tags: [TAG],
  summary:
    'List persisted notification deliveries and attempts for the caller’s wallet.',
  operationId: 'remoteWallets.notificationDeliveries.list',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    query: schemas.RemoteWalletNotificationListQuery
  },
  responses: {
    200: inlineJsonResponse(
      'Notification delivery journal.',
      z.object({
        deliveries: z.array(notificationDeliverySchema),
        nextCursor: z.string().nullable()
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/remote-wallets/{id}/notification-deliveries/{deliveryId}/retry',
  tags: [TAG],
  summary: 'Retry a safely retryable outbound notification delivery.',
  operationId: 'remoteWallets.notificationDeliveries.retry',
  security: protectedSecurity,
  request: { params: schemas.RemoteWalletNotificationDeliveryParams },
  responses: {
    202: inlineJsonResponse(
      'Retry accepted.',
      z.object({ accepted: z.literal(true) })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/{id}/payments/{paymentHash}',
  tags: [TAG],
  summary:
    'Read the NIP-57 zap request and receipt audit for an owned wallet payment.',
  operationId: 'remoteWallets.payments.zapAudit',
  security: protectedSecurity,
  request: { params: schemas.RemoteWalletPaymentParams },
  responses: {
    200: inlineJsonResponse('Zap audit envelope.', zapEnvelopeSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/remote-wallets/forwarding-map',
  tags: [TAG],
  summary: 'List the caller’s current RemoteWallet forwarding destinations.',
  operationId: 'remoteWallets.forwardingMap.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Forwarding map projection.',
      z.object({
        actions: z.array(
          z.object({
            walletId: z.string(),
            enabled: z.boolean(),
            destinations: z.array(destinationSchema)
          })
        )
      })
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
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
      content: {
        'application/json': { schema: schemas.RemoteWalletCreateRequest }
      }
    }
  },
  responses: {
    201: inlineJsonResponse('Remote wallet created.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
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
        'application/json': { schema: schemas.RemoteWalletLncurlCreateRequest }
      }
    }
  },
  responses: {
    201: inlineJsonResponse('LNCurl wallet created.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
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
    404: responses.notFound
  }
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
      content: {
        'application/json': { schema: schemas.RemoteWalletUpdateRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse('Remote wallet updated.', remoteWalletSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict
  }
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
    404: responses.notFound
  }
})
