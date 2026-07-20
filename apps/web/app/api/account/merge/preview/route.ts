import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { accountMergePreviewRequestSchema } from '@/lib/validation/schemas'
import { verifyMergeTicket } from '@/lib/account/proof'
import { previewMerge } from '@/lib/account/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/merge/preview`
 *
 * Read-only dry run of a merge: both accounts' resource summaries, the
 * collisions the merge would reconcile, and whether it is blocked (the
 * other account custodies a never-exported key). Requires a valid merge
 * ticket from link/verify — possession of a ticket IS the proof that the
 * caller controls both accounts.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.auth,
    identifier: 'account-merge:' + auth.pubkey
  })

  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const body = await validateBody(request, accountMergePreviewRequestSchema)
  const ticket = verifyMergeTicket(body.mergeTicket, account.id)

  const preview = await previewMerge(ticket.survivorId, ticket.absorbedId)
  return NextResponse.json(preview)
})
