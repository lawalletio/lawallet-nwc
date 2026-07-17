import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import {
  CEREMONY_TIMEOUT_MS,
  parseTransports,
  resolveRpContext,
  storeWebAuthnChallenge
} from '@/lib/auth/passkey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/auth/passkey/link/options`
 *
 * Mints WebAuthn registration options so an EXISTING, currently authenticated
 * user (Nostr NIP-98 or Bearer JWT — any method) can attach a passkey to
 * their account. The challenge is stored flow=LINK and bound to the user's
 * id; the verify step re-checks that binding against whoever is
 * authenticated at consume time.
 *
 * Requires an existing User row — this route never lazily creates accounts
 * (that's the REGISTER flow's job).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.auth,
    identifier: 'passkey-link:' + auth.pubkey
  })

  const user = await prisma.user.findUnique({
    where: { pubkey: auth.pubkey },
    include: { passkeyCredentials: true }
  })
  if (!user) throw new NotFoundError('User not found')

  const rp = await resolveRpContext(request)
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: 'lawallet-' + auth.pubkey.slice(0, 8),
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    },
    timeout: CEREMONY_TIMEOUT_MS,
    // Stops the browser from re-registering an authenticator the account
    // already has — the OS picker greys those out.
    excludeCredentials: user.passkeyCredentials.map(c => ({
      id: c.id,
      transports: parseTransports(c.transports)
    }))
  })

  await storeWebAuthnChallenge({
    challenge: options.challenge,
    flow: 'LINK',
    userId: user.id,
    rpId: rp.rpId,
    origin: rp.origin
  })

  return NextResponse.json({ options })
})
