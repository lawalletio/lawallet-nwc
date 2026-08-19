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

const TAG = 'Vouchers'

const voucherStatusSchema = z.enum(['MINTED', 'CLAIMED', 'EXPIRED', 'VOIDED'])

const voucherSchema = z
  .object({
    id: z.string(),
    /** The coupon code — a bearer credential, only ever sent to its owner. */
    nonce: z.string(),
    couponId: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    url: z.string().nullable(),
    merchantPubkey: z.string(),
    servicePubkey: z.string(),
    claimUrl: z.string(),
    mintUrl: z.string().nullable(),
    metadata: z.record(z.unknown()).nullable(),
    voucherEvent: z.record(z.unknown()).nullable(),
    status: voucherStatusSchema,
    expiresAt: z.string().datetime().nullable(),
    claimedAt: z.string().datetime().nullable(),
    statusCheckedAt: z.string().datetime().nullable(),
    depositedBy: z.string(),
    createdAt: z.string().datetime()
  })
  .openapi({ description: 'A coupon held on the caller’s behalf.' })

const voucherSettingsSchema = z.object({
  policy: z.enum(['ANYONE', 'ALLOWLIST']),
  allowlist: z.array(z.object({ pubkey: z.string(), npub: z.string() }))
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/vouchers',
  tags: [TAG],
  summary: 'Deposit a voucher to a member’s npub.',
  description:
    'Public deposit endpoint for external coupon-manager services. The caller ' +
    'authenticates with NIP-98 (or a Bearer session) but does **not** need an ' +
    'account on this instance. The write is gated by the *recipient’s* deposit ' +
    'policy, and a signer the recipient does not accept gets the same 403 as an ' +
    'unknown npub — this endpoint is deliberately not an account-existence oracle.\n\n' +
    'Idempotent on `(servicePubkey, nonce)`: a redeposit refreshes the row and ' +
    'returns 200 rather than conflicting.',
  security: protectedSecurity,
  request: { body: { content: jsonContent('DepositVoucher') } },
  responses: {
    201: inlineJsonResponse(
      'Voucher stored.',
      z.object({ id: z.string(), status: voucherStatusSchema })
    ),
    200: inlineJsonResponse(
      'Voucher already existed and was refreshed.',
      z.object({ id: z.string(), status: voucherStatusSchema })
    ),
    ...commonErrorResponses,
    413: responses.payloadTooLarge,
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/vouchers',
  tags: [TAG],
  summary: 'List the caller’s vouchers.',
  security: protectedSecurity,
  request: { query: z.object({ status: voucherStatusSchema.optional() }) },
  responses: {
    200: inlineJsonResponse(
      'The caller’s vouchers, newest first.',
      z.array(voucherSchema)
    ),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/vouchers/{id}',
  tags: [TAG],
  summary: 'Get one of the caller’s vouchers.',
  description:
    'A voucher belonging to another account is reported as missing rather ' +
    'than forbidden, so ids cannot be probed.',
  security: protectedSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: inlineJsonResponse('The voucher.', voucherSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/wallet/vouchers/{id}',
  tags: [TAG],
  summary: 'Remove a voucher from the caller’s stash.',
  description:
    'Local only — the coupon stays valid at the merchant for anyone holding ' +
    'the nonce. Voiding is the merchant’s call, not ours.',
  security: protectedSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: inlineJsonResponse('Removed.', z.object({ deleted: z.boolean() })),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/wallet/vouchers/{id}/refresh',
  tags: [TAG],
  summary: 'Re-read a voucher’s status from its coupon service.',
  description:
    'Polls `GET {claimUrl}?nonce=`. Status is monotonic: a voucher already ' +
    'CLAIMED or VOIDED is never walked back, and is not polled at all. ' +
    '`checked: false` means the poll was skipped (terminal status, or a ' +
    'recent check still within the cooldown).',
  security: protectedSecurity,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: inlineJsonResponse(
      'The voucher, refreshed or unchanged.',
      z.object({ voucher: voucherSchema, checked: z.boolean() })
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    429: responses.rateLimited,
    503: responses.serviceUnavailable
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/wallet/vouchers/settings',
  tags: [TAG],
  summary: 'Get the caller’s voucher deposit policy.',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Deposit policy.', voucherSettingsSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/wallet/vouchers/settings',
  tags: [TAG],
  summary: 'Set who may deposit vouchers to the caller.',
  description:
    'Allowlist entries may be hex, npub, or NIP-05, and are resolved to hex ' +
    'here so deposits stay a plain membership test. An entry that cannot be ' +
    'resolved fails the whole save — a silently shortened list would leave ' +
    'the owner believing a sender is allowed when they are not.',
  security: protectedSecurity,
  request: { body: { content: jsonContent('UpdateVoucherSettings') } },
  responses: {
    200: inlineJsonResponse('Updated policy.', voucherSettingsSchema),
    ...commonErrorResponses,
    404: responses.notFound
  }
})
