import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError } from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import {
  CEREMONY_TIMEOUT_MS,
  resolveRpContext,
  storeWebAuthnChallenge
} from '@/lib/auth/passkey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/auth/passkey/authentication/options`
 *
 * Unauthenticated first leg of a passkey login. Mints WebAuthn assertion
 * options with an empty `allowCredentials` list — discoverable-credential
 * (username-less) login: the authenticator picks which resident passkey to
 * use, so the server never learns anything about who is attempting to log
 * in until the signed assertion comes back on the verify leg.
 *
 * The challenge is persisted server-side pinned to this instance's
 * rpID/origin and consumed single-use by
 * `POST /api/auth/passkey/authentication/verify`.
 *
 * NOTE: only gated on JWT config (needed to mint the session on verify) —
 * deliberately NOT gated on the key vault, since linked-custody users must
 * be able to log in even when the vault is unconfigured.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)

  const config = getConfig()
  if (!config.jwt.enabled) {
    throw new InternalServerError('Server configuration error')
  }

  const rp = await resolveRpContext(request)

  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: 'required',
    allowCredentials: [],
    timeout: CEREMONY_TIMEOUT_MS
  })

  await storeWebAuthnChallenge({
    challenge: options.challenge,
    flow: 'LOGIN',
    rpId: rp.rpId,
    origin: rp.origin
  })

  return NextResponse.json({ options })
})
