// OAuth 2.1 authorization server operations (`/api/oauth/*`).
//
// Discovery lives outside `/api` and is not modeled here:
// `/.well-known/oauth-authorization-server` (RFC 8414) and
// `/.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728).
import { z } from 'zod'
import {
  idParam,
  oauthAuthorizeContextSchema,
  oauthAuthorizeDecisionResponseSchema,
  oauthAuthorizeDecisionSchema,
  oauthAuthorizeQuerySchema,
  oauthClientRegistrationResponseSchema,
  oauthClientRegistrationSchema,
  oauthErrorResponseSchema,
  oauthGrantListResponseSchema,
  oauthRevokeRequestSchema,
  oauthTokenRequestSchema,
  oauthTokenResponseSchema
} from '@lawallet-nwc/shared'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  publicSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { errorResponse, responses } from '../responses'

const TAG = 'OAuth'

// Protocol endpoints answer errors in RFC 6749 shape, not the app envelope.
const oauthError = (description: string) =>
  inlineJsonResponse(description, oauthErrorResponseSchema)

// Token and revocation take the standard form encoding; JSON is also accepted.
const formOrJson = (schema: z.ZodTypeAny) => ({
  content: {
    'application/x-www-form-urlencoded': { schema },
    'application/json': { schema }
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/oauth/register',
  tags: [TAG],
  summary: 'Register an OAuth client (RFC 7591).',
  description:
    'Dynamic client registration for MCP hosts. Only `redirect_uris` is ' +
    'required: `https:` URIs, `http:` on a loopback host, or a native app ' +
    'scheme such as `cursor://`. Every client is registered as a public PKCE ' +
    'client whatever it asks for — `token_endpoint_auth_method`, ' +
    '`grant_types`, `application_type` and other metadata are ignored, and ' +
    'the response states what was registered. Clients older than 30 days ' +
    'that never obtained a grant are removed.',
  operationId: 'oauth.register',
  security: publicSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: oauthClientRegistrationSchema }
      }
    }
  },
  responses: {
    201: inlineJsonResponse(
      'Client registered.',
      oauthClientRegistrationResponseSchema
    ),
    400: oauthError('`invalid_redirect_uri` or `invalid_client_metadata`.'),
    413: responses.payloadTooLarge,
    429: responses.rateLimited,
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'get',
  path: '/api/oauth/authorize',
  tags: [TAG],
  summary: 'Validate an authorization request for the consent screen.',
  description:
    'Called by the consent page (`/oauth/authorize`, the advertised ' +
    '`authorization_endpoint`) with the OAuth query it received. Checks the ' +
    'client, that `redirect_uri` is registered (loopback URIs match on any ' +
    'port), `response_type=code`, PKCE S256 and the `resource`, then ' +
    'describes the request. `scopes` lists the requested scopes this server ' +
    'knows (all of them when none is known); `read` is implied by `write` ' +
    'and `spend`. A parameter sent twice is rejected.',
  operationId: 'oauth.authorize.validate',
  security: publicSecurity,
  request: { query: oauthAuthorizeQuerySchema },
  responses: {
    200: inlineJsonResponse(
      'The request is valid; what to show on the consent screen.',
      oauthAuthorizeContextSchema
    ),
    400: oauthError(
      '`invalid_client`, `invalid_request`, `unsupported_response_type` or `invalid_target`. Shown in place — never redirected.'
    ),
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/oauth/authorize',
  tags: [TAG],
  summary: 'Approve or deny an authorization request.',
  description:
    'The signed-in user’s decision. Answers with `redirectTo`: the client’s ' +
    'redirect URI carrying a single-use `code` (valid 5 minutes) or ' +
    '`error=access_denied`, plus `state` and `iss` (RFC 9207). Approving ' +
    'needs at least one scope out of those offered; `spend` requires ' +
    '`spendLimitSats`, a rolling 24-hour budget. A new approval replaces the ' +
    'account’s earlier grant for the same client. Requires a full session: ' +
    'device tokens get 403.',
  operationId: 'oauth.authorize.decide',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: oauthAuthorizeDecisionSchema }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Where to send the browser.',
      oauthAuthorizeDecisionResponseSchema
    ),
    ...commonErrorResponses,
    404: errorResponse('Unknown `client_id`.'),
    413: responses.payloadTooLarge
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/oauth/token',
  tags: [TAG],
  summary: 'Exchange a code or refresh token for tokens.',
  description:
    '`authorization_code` takes the single-use code, its `code_verifier` ' +
    '(PKCE S256), the same `redirect_uri` and `client_id`; presenting a code ' +
    'twice revokes the grant. `refresh_token` takes the refresh token and ' +
    '`client_id`. Every success rotates both tokens: the previous ones stop ' +
    'working at once. Access tokens (`lwat_…`) last one hour and are only ' +
    'accepted by `/api/mcp`; refresh tokens (`lwrt_…`) expire after 30 days ' +
    'without use. `resource`, when sent, must be the MCP URL or its origin.',
  operationId: 'oauth.token',
  security: publicSecurity,
  request: { body: formOrJson(oauthTokenRequestSchema) },
  responses: {
    200: inlineJsonResponse('New token pair.', oauthTokenResponseSchema),
    400: oauthError(
      '`invalid_request`, `invalid_client`, `invalid_grant`, `unsupported_grant_type` or `invalid_target`.'
    ),
    413: responses.payloadTooLarge,
    429: responses.rateLimited,
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/oauth/revoke',
  tags: [TAG],
  summary: 'Revoke a token (RFC 7009).',
  description:
    'Revokes the whole grant the access or refresh token belongs to. Always ' +
    '200 with an empty object, even for an unknown token.',
  operationId: 'oauth.revoke',
  security: publicSecurity,
  request: { body: formOrJson(oauthRevokeRequestSchema) },
  responses: {
    200: inlineJsonResponse('Done.', z.object({})),
    400: oauthError('`invalid_request`: no token.'),
    413: responses.payloadTooLarge,
    429: responses.rateLimited,
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/oauth/grants',
  tags: [TAG],
  summary: 'List the caller’s connected apps.',
  description:
    'OAuth grants of the caller that are in use: code exchanged, not revoked, ' +
    'refresh token not expired. Newest first. Requires a full session.',
  operationId: 'oauth.grants.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'The caller’s active grants.',
      oauthGrantListResponseSchema
    ),
    401: responses.unauthenticated,
    403: responses.forbidden,
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/oauth/grants/{id}',
  tags: [TAG],
  summary: 'Disconnect an app.',
  description:
    'Revokes one of the caller’s grants; its tokens stop working at once. The ' +
    'record is kept for the MCP payment ledger. A grant that is not the ' +
    'caller’s is reported as missing. Requires a full session.',
  operationId: 'oauth.grants.revoke',
  security: protectedSecurity,
  request: { params: idParam },
  responses: {
    200: inlineJsonResponse('Revoked.', z.object({ success: z.literal(true) })),
    ...commonErrorResponses,
    404: responses.notFound
  }
})
