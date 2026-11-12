import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import {
  emailLoginTokenSchema,
  type EmailLoginVerifyResponse
} from '@/lib/validation/schemas'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  assertEmailLoginEnabled,
  consumeEmailLoginToken,
  loginOrSignupByEmail
} from '@/lib/auth/email-login'

/**
 * Consumes a magic-link token and hands the client the account's custodied
 * secret key ONCE — creating the account first for a new email. The client
 * then signs NIP-98 and exchanges it at `/api/jwt` like any other signer, so
 * session refresh and reload work unchanged.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)
  await assertEmailLoginEnabled()

  const { token } = await validateBody(request, emailLoginTokenSchema)
  const email = await consumeEmailLoginToken(token)
  const result = await loginOrSignupByEmail(email)

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_EMAIL_LOGIN,
    level: 'INFO',
    message: `Email ${result.isNew ? 'signup' : 'login'} for ${result.pubkey.slice(0, 8)}…`,
    metadata: { pubkey: result.pubkey, isNew: result.isNew }
  })

  return NextResponse.json(result satisfies EmailLoginVerifyResponse, {
    headers: { 'cache-control': 'no-store' }
  })
})
