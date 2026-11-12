import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { emailLoginRequestSchema } from '@/lib/validation/schemas'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { sendEmail } from '@/lib/email/send'
import { logger } from '@/lib/logger'
import {
  assertEmailLoginEnabled,
  EMAIL_LOGIN_TTL_MINUTES,
  findUserByEmail,
  issueEmailLoginToken,
  maskEmail
} from '@/lib/auth/email-login'

/**
 * Sends a magic link to `email`. One form for everybody: a known address gets
 * the `login` template, an unknown one the `signup` template — the response is
 * identical either way, so this endpoint never reveals whether an account
 * exists.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.sensitive)
  await assertEmailLoginEnabled()

  const { email, locale } = await validateBody(request, emailLoginRequestSchema)

  // Per-address cap so nobody can mail-bomb an inbox from many IPs.
  await rateLimit(request, {
    bucket: 'email-login',
    identifier: email,
    maxRequests: 3,
    windowMs: 15 * 60_000
  })

  const [user, token, { url }] = await Promise.all([
    findUserByEmail(email),
    issueEmailLoginToken(email),
    resolvePublicEndpoint(request)
  ])

  // Fragment, not query: the token never reaches server logs or Referer.
  const link = `${url}/wallet/auth/email#token=${token}`

  await sendEmail({
    to: email,
    template: user ? 'login' : 'signup',
    locale,
    data: { link, expiresMinutes: EMAIL_LOGIN_TTL_MINUTES },
    request
  })
  logger.info({ email: maskEmail(email), isNew: !user }, 'Magic link sent')

  return NextResponse.json({ ok: true })
})
