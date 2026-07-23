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
 *   tag; the pair goes to link/verify. Proving a PASSKEY-held account uses
 *   this same flow — the client derives that passkey's key via PRF and signs
 *   the proof with it; the server never sees a WebAuthn assertion here.
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

  await validateBody(request, accountLinkBeginRequestSchema)

  const { challenge, nonce, expiresIn } = mintNostrLinkChallenge(account.id)
  return NextResponse.json({ challenge, nonce, expiresIn })
})
