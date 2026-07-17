import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
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

/**
 * `POST /api/auth/passkey/nsec/export/options`
 *
 * Step-up ceremony start for exporting the custodied nsec: mints a fresh
 * WebAuthn authentication challenge bound to the `EXPORT` flow. A login
 * challenge can never be replayed to unlock an export — the flow is pinned
 * server-side and checked on consumption.
 *
 * 404 (never 403) for accounts without a managed key or without passkeys,
 * matching the ownership idiom used across the API.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'nsec-export:' + auth.pubkey
  })

  const user = await prisma.user.findUnique({
    where: { pubkey: auth.pubkey },
    include: { passkeyCredentials: true }
  })
  if (!user) throw new NotFoundError('User not found')

  const managed = await prisma.managedNostrKey.findUnique({
    where: { userId: user.id }
  })
  if (!managed) throw new NotFoundError('No managed key for this account')

  if (user.passkeyCredentials.length === 0) {
    // Nothing to step up with — the export ceremony requires a passkey.
    throw new NotFoundError('No passkey available for this account')
  }

  const rp = await resolveRpContext(request)
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: 'required',
    timeout: CEREMONY_TIMEOUT_MS,
    allowCredentials: user.passkeyCredentials.map(c => ({
      id: c.id,
      transports: parseTransports(c.transports)
    }))
  })

  await storeWebAuthnChallenge({
    challenge: options.challenge,
    flow: 'EXPORT',
    userId: user.id,
    rpId: rp.rpId,
    origin: rp.origin
  })

  return NextResponse.json({ options })
})
