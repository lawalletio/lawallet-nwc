import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateBody } from '@/lib/validation/middleware'
import {
  oauthAuthorizeDecisionSchema,
  oauthAuthorizeQuerySchema,
  type OAuthAuthorizeContext
} from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { resolveApiUrl } from '@/lib/public-url'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { createNewUser } from '@/lib/user'
import {
  DEFAULT_SPEND_LIMIT_SATS,
  MAX_SPEND_LIMIT_SATS
} from '@/lib/oauth/constants'
import {
  NO_STORE_HEADERS,
  oauthParams,
  parseOAuth,
  toAppError,
  withOAuthErrors
} from '@/lib/oauth/protocol'
import {
  buildRedirect,
  redirectHost,
  validateAuthorizationRequest
} from '@/lib/oauth/authorize'
import {
  authenticateSession,
  createAuthorizationGrant,
  resolveApproval
} from '@/lib/oauth/grants'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/oauth/authorize` — validates an authorization request for the
 * consent page (`/oauth/authorize`) and describes it. Errors are RFC 6749
 * shaped and the page shows them in place; it never redirects on them.
 */
export const GET = withErrorHandling(
  withOAuthErrors(async (request: NextRequest) => {
    await rateLimit(request, { bucket: 'oauthAuthorize' })
    const params = parseOAuth(
      oauthParams(request.nextUrl.searchParams),
      oauthAuthorizeQuerySchema
    )
    const authorization = await validateAuthorizationRequest(
      params,
      await resolveApiUrl(request)
    )

    return NextResponse.json({
      client: authorization.client,
      redirectUri: authorization.redirectUri,
      redirectHost: redirectHost(authorization.redirectUri),
      scopes: authorization.scopes,
      resource: authorization.resource,
      defaultSpendLimitSats: DEFAULT_SPEND_LIMIT_SATS,
      maxSpendLimitSats: MAX_SPEND_LIMIT_SATS
    } satisfies OAuthAuthorizeContext)
  })
)

/**
 * `POST /api/oauth/authorize` — the signed-in user's decision. Answers with
 * the URL to send the browser to: the client's redirect URI carrying either
 * a single-use code or `error=access_denied`, plus `state` and `iss`
 * (RFC 9207 — on every response, or ChatGPT and Claude Code reject the flow).
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticateSession(request)
  const body = await validateBody(request, oauthAuthorizeDecisionSchema)
  const apiUrl = await resolveApiUrl(request)
  const authorization = await validateAuthorizationRequest(body, apiUrl).catch(
    toAppError
  )

  const redirectTo = (response: Record<string, string>) =>
    NextResponse.json(
      {
        redirectTo: buildRedirect(authorization.redirectUri, {
          ...response,
          state: authorization.state,
          iss: apiUrl
        })
      },
      { headers: NO_STORE_HEADERS }
    )

  if (!body.approve) return redirectTo({ error: 'access_denied' })

  const { scopes, spendLimitSats } = resolveApproval(
    body.scopes,
    body.spendLimitSats,
    authorization.scopes
  )
  const account = await resolveAccountByPubkey(auth.pubkey)
  const userId = account?.id ?? (await createNewUser(auth.pubkey)).id

  const code = await createAuthorizationGrant({
    userId,
    client: authorization.client,
    redirectUri: authorization.redirectUri,
    codeChallenge: authorization.codeChallenge,
    resource: authorization.resource,
    scopes,
    spendLimitSats
  })
  return redirectTo({ code })
})
