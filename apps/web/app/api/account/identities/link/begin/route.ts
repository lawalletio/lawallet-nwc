import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { accountLinkBeginRequestSchema } from '@/lib/validation/schemas'
import { mintNostrLinkChallenge } from '@/lib/account/proof'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/identities/link/begin`
 *
 * First leg of proving control of ANOTHER Nostr key/account so it can be
 * linked into (or merged with) the caller's account.
 *
 * - `method: 'nostr'` — returns a challenge token + nonce. The other key
 *   signs a NIP-42 (kind 22242) event carrying the nonce in a `challenge`
 *   tag; the pair goes to link/verify.
 * - `method: 'passkey'` — no server state needed here: the client obtains a
 *   standard LOGIN assertion via `POST /api/auth/passkey/authentication/options`
 *   and submits it to link/verify (single-use challenge semantics included).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'account-link:' + auth.pubkey
  })
  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const body = await validateBody(request, accountLinkBeginRequestSchema)

  if (body.method === 'passkey') {
    return NextResponse.json({ expiresIn: 300 })
  }

  const { challenge, nonce, expiresIn } = mintNostrLinkChallenge(account.id)
  return NextResponse.json({ challenge, nonce, expiresIn })
})
