import { z } from 'zod'
import {
  inlineJsonResponse,
  publicErrorResponses,
  publicSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'LUD-16'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}',
  tags: [TAG],
  summary: 'LUD-16 / LUD-06 pay request lookup.',
  description:
    'Public lookup that resolves a lightning address to a LUD-06 pay request response. ' +
    'Supports LUD-12 (commentAllowed) and LUD-21 (verify field).\n\n' +
    'Emits `allowVouchers: true` when the owner has opted in to receiving ' +
    'coupon transfers on the callback. Absent means do not send one.',
  operationId: 'lud16.payRequest',
  security: publicSecurity,
  request: { params: schemas.Lud16UsernameParam },
  responses: {
    200: inlineJsonResponse('Pay request.', z.object({}).passthrough()),
    ...publicErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}/cb',
  tags: [TAG],
  summary: 'LUD-16 callback that returns a BOLT11 invoice.',
  operationId: 'lud16.callback',
  security: publicSecurity,
  request: {
    params: schemas.Lud16UsernameParam,
    query: schemas.Lud16CallbackQuery
  },
  responses: {
    200: inlineJsonResponse(
      'Callback response with the BOLT11 invoice.',
      z.object({ pr: z.string() }).passthrough()
    ),
    ...publicErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/lud16/{username}/verify/{paymentHash}',
  tags: [TAG],
  summary: 'LUD-21 payment verification.',
  operationId: 'lud16.verify',
  security: publicSecurity,
  request: {
    params: z.object({
      username: z
        .string()
        .min(1)
        .openapi({ description: 'Lightning address username.' }),
      paymentHash: z
        .string()
        .min(1)
        .openapi({ description: 'BOLT11 payment hash returned by /cb.' })
    })
  },
  responses: {
    200: inlineJsonResponse(
      'Verification status.',
      z.object({ status: z.enum(['OK', 'ERROR']) }).passthrough()
    ),
    ...publicErrorResponses,
    404: responses.notFound
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/lud16/{username}/cb',
  tags: [TAG],
  summary: 'LUD-16 callback actions (voucher transfer).',
  description:
    'The same callback URL as LNURL-pay, dispatched by action. `GET` is ' +
    'ordinary LNURL-pay; `POST` carries actions, keyed on `action` in the body.\n\n' +
    'Today the only action is `voucher`: take delivery of a lacrypta/coupons ' +
    'voucher. The receiver verifies the signed kind-20402, resolves the signing ' +
    'service against services it already knows — never against a URL from the ' +
    'request — and swaps the nonce before answering.\n\n' +
    'Refusals are `200` with an LNURL `ERROR` body, and are deliberately ' +
    'uniform: distinguishing "no such user" from "not accepting" would let a ' +
    'caller enumerate the community.',
  operationId: 'lud16.callbackAction',
  security: publicSecurity,
  request: {
    params: schemas.Lud16UsernameParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.literal('voucher'),
            nonce: z.string().length(22),
            voucher: z.record(z.unknown()),
            comment: z.string().max(200).optional()
          })
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Accepted, or an LNURL-shaped refusal.',
      z.union([
        z.object({ status: z.literal('ACCEPTED') }),
        z.object({ status: z.literal('ERROR'), reason: z.string() })
      ])
    ),
    ...publicErrorResponses,
    429: responses.rateLimited
  }
})
