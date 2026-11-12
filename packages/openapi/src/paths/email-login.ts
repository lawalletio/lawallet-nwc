import {
  emailLoginPreviewResponseSchema,
  emailLoginRequestResponseSchema,
  emailLoginRequestSchema,
  emailLoginTokenSchema,
  emailLoginVerifyResponseSchema
} from '@lawallet-nwc/shared'
import {
  inlineJsonResponse,
  publicErrorResponses,
  publicSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { errorResponse, responses } from '../responses'

const TAG = 'Email login'

const disabled = errorResponse(
  'Email login is disabled (or no email provider / KEY_VAULT_SECRET is configured).'
)

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/email/request',
  tags: [TAG],
  summary: 'Email a magic sign-in link (signs up unknown addresses).',
  description:
    'One form for new and returning users. Always answers `{ ok: true }` so ' +
    'it never reveals whether an account exists. The link carries a 256-bit, ' +
    'single-use token (only its SHA-256 is stored) that expires in 15 ' +
    'minutes. Rate limited per IP and per address.',
  operationId: 'auth.email.request',
  security: publicSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: emailLoginRequestSchema } }
    }
  },
  responses: {
    200: inlineJsonResponse('Link sent.', emailLoginRequestResponseSchema),
    ...publicErrorResponses,
    404: disabled,
    429: responses.rateLimited,
    503: errorResponse('The email provider is unavailable.')
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/email/preview',
  tags: [TAG],
  summary: 'Preview who a magic link signs in, without consuming it.',
  description:
    'Lets the landing page show the avatar and display name before the user ' +
    'confirms, so mail scanners that open links cannot burn the token.',
  operationId: 'auth.email.preview',
  security: publicSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: emailLoginTokenSchema } }
    }
  },
  responses: {
    200: inlineJsonResponse('Link preview.', emailLoginPreviewResponseSchema),
    ...publicErrorResponses,
    401: responses.unauthenticated,
    404: disabled,
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/email/verify',
  tags: [TAG],
  summary: 'Consume a magic link: sign in, or create the account.',
  description:
    'Atomically consumes the token. A new address gets a fresh account with a ' +
    'server-custodied Nostr key (key vault). The secret key is returned once ' +
    'so the client can sign NIP-98 and exchange it at `/api/jwt`.',
  operationId: 'auth.email.verify',
  security: publicSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: emailLoginTokenSchema } }
    }
  },
  responses: {
    200: inlineJsonResponse('Signed in.', emailLoginVerifyResponseSchema),
    ...publicErrorResponses,
    401: responses.unauthenticated,
    404: disabled,
    409: errorResponse('The account has no hosted key.'),
    429: responses.rateLimited
  }
})
