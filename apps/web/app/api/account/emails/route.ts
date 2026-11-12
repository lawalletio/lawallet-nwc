import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { accountEmailLinkRequestSchema } from '@/lib/validation/schemas'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { sendEmail } from '@/lib/email/send'
import {
  assertEmailLoginEnabled,
  EMAIL_LOGIN_TTL_MINUTES,
  issueEmailLoginToken
} from '@/lib/auth/email-login'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/emails`
 *
 * Emails a confirmation link for adding `email` to the caller's account.
 * Opening it (`/api/account/emails/verify`) links the email — or, when it
 * already signs in to another account, starts a merge. Whether the email is
 * taken is never revealed here.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'account-email:' + auth.pubkey
  })
  await assertEmailLoginEnabled()

  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const { email, locale } = await validateBody(
    request,
    accountEmailLinkRequestSchema
  )
  // Same per-address cap as sign-in links, so nobody mail-bombs an inbox.
  await rateLimit(request, {
    bucket: 'email-login',
    identifier: email,
    maxRequests: 3,
    windowMs: 15 * 60_000
  })

  const existing = await prisma.emailIdentity.findUnique({ where: { email } })
  if (existing?.userId === account.id) {
    throw new ConflictError('This email is already linked to your account')
  }

  const [token, { url }] = await Promise.all([
    issueEmailLoginToken(email, account.id),
    resolvePublicEndpoint(request)
  ])
  await sendEmail({
    to: email,
    template: 'link',
    locale,
    data: {
      link: `${url}/wallet/auth/email#token=${token}&ctx=link`,
      expiresMinutes: EMAIL_LOGIN_TTL_MINUTES
    },
    request
  })

  return NextResponse.json({ ok: true })
})
