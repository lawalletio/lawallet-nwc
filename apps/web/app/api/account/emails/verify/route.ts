import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError } from '@/types/server/errors'
import { prisma } from '@/lib/prisma'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import {
  emailLoginTokenSchema,
  type AccountEmailLinkVerifyResponse
} from '@/lib/validation/schemas'
import { mintMergeTicket } from '@/lib/account/proof'
import {
  assertEmailLoginEnabled,
  consumeEmailLoginToken,
  linkEmailToAccount,
  maskEmail
} from '@/lib/auth/email-login'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/emails/verify`
 *
 * Consumes a "link this email" token from `POST /api/account/emails`. No
 * session needed: the token is bound to the account that requested it, and
 * holding it proves control of the email (so the link works on any device).
 *
 * - Unclaimed email → linked to the requesting account.
 * - Already on that account → no-op, `linked: true`.
 * - Signs in to ANOTHER account → nothing is written; a merge ticket bound
 *   to (requesting account, other account) is returned. Only a session of
 *   the requesting account can redeem it (`/api/account/merge/*`).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)
  await assertEmailLoginEnabled()

  const { token } = await validateBody(request, emailLoginTokenSchema)
  const { email, linkUserId } = await consumeEmailLoginToken(token, 'link')
  if (!linkUserId) throw new AuthenticationError('Invalid link')

  const owner = await prisma.emailIdentity.findUnique({
    where: { email },
    select: { user: { select: { id: true, pubkey: true } } }
  })

  let body: AccountEmailLinkVerifyResponse
  if (!owner) {
    await linkEmailToAccount(linkUserId, email)
    body = { linked: true, email: maskEmail(email) }
  } else if (owner.user.id === linkUserId) {
    body = { linked: true, email: maskEmail(email) }
  } else {
    body = {
      linked: false,
      email: maskEmail(email),
      mergeTicket: mintMergeTicket({
        survivorId: linkUserId,
        absorbedId: owner.user.id,
        provenPubkey: owner.user.pubkey
      })
    }
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
})
