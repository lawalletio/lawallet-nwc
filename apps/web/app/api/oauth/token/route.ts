import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { oauthTokenRequestSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { OAUTH_GRANT_TYPES } from '@/lib/oauth/constants'
import {
  NO_STORE_HEADERS,
  OAUTH_TOKEN_RATE_LIMIT,
  OAuthError,
  parseOAuth,
  readOAuthBody,
  withOAuthErrors
} from '@/lib/oauth/protocol'
import {
  exchangeAuthorizationCode,
  refreshAccessToken
} from '@/lib/oauth/grants'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/oauth/token` — swaps an authorization code (with its PKCE
 * verifier) or a refresh token for a new access/refresh token pair. Both are
 * rotated on every call.
 */
export const POST = withErrorHandling(
  withOAuthErrors(async (request: Request) => {
    await checkRequestLimits(request, 'json')
    await rateLimit(request, OAUTH_TOKEN_RATE_LIMIT)

    const body = await readOAuthBody(request)
    const grantType = (body as { grant_type?: unknown } | null)?.grant_type
    if (
      grantType !== undefined &&
      !(OAUTH_GRANT_TYPES as readonly unknown[]).includes(grantType)
    ) {
      throw new OAuthError(
        'unsupported_grant_type',
        'Supported grant types: authorization_code, refresh_token'
      )
    }

    const params = parseOAuth(body, oauthTokenRequestSchema)
    const tokens =
      params.grant_type === 'authorization_code'
        ? await exchangeAuthorizationCode(params)
        : await refreshAccessToken(params)

    return NextResponse.json(tokens, { headers: NO_STORE_HEADERS })
  })
)
