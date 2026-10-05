import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { oauthRevokeRequestSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit } from '@/lib/middleware/rate-limit'
import {
  OAUTH_TOKEN_RATE_LIMIT,
  parseOAuth,
  readOAuthBody,
  withOAuthErrors
} from '@/lib/oauth/protocol'
import { revokeToken } from '@/lib/oauth/grants'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/oauth/revoke` — RFC 7009. Revokes the whole grant an access or
 * refresh token belongs to. Answers 200 even for an unknown token (§2.2), so
 * the endpoint says nothing about which tokens exist.
 */
export const POST = withErrorHandling(
  withOAuthErrors(async (request: Request) => {
    await checkRequestLimits(request, 'json')
    await rateLimit(request, OAUTH_TOKEN_RATE_LIMIT)

    const { token } = parseOAuth(
      await readOAuthBody(request),
      oauthRevokeRequestSchema
    )
    await revokeToken(token)

    return NextResponse.json({})
  })
)
