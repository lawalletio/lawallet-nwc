import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { accountMergeRequestSchema } from '@/lib/validation/schemas'
import { verifyMergeTicket } from '@/lib/account/proof'
import { mergeAccounts } from '@/lib/account/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/merge`
 *
 * Destructive commit of an account merge. The merge ticket (from
 * link/verify) proves the caller controls both accounts; `mainPubkey`
 * selects which of the combined identities becomes primary. The absorbed
 * account's resources are re-parented onto the caller's account inside one
 * transaction and its User row is deleted. Refused (409) while the absorbed
 * account custodies a never-exported key.
 *
 * The caller's session stays valid: its JWT pubkey remains one of the
 * merged account's identities, so `authenticate()` keeps resolving to the
 * surviving account. Clients should still refresh their token so the
 * session presents the new primary.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'account-merge:' + auth.pubkey
  })

  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const body = await validateBody(request, accountMergeRequestSchema)
  const ticket = verifyMergeTicket(body.mergeTicket, account.id)

  const result = await mergeAccounts({
    survivorId: ticket.survivorId,
    absorbedId: ticket.absorbedId,
    mainPubkey: body.mainPubkey
  })

  return NextResponse.json(result)
})
