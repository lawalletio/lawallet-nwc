import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { ServiceUnavailableError } from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyRegistrationOptionsRequestSchema } from '@/lib/validation/schemas'
import {
  CEREMONY_TIMEOUT_MS,
  resolveRpContext,
  storeWebAuthnChallenge
} from '@/lib/auth/passkey'

export const runtime = 'nodejs'

/**
 * `POST /api/auth/passkey/registration/options`
 *
 * Starts a passkey creation ceremony (new-account signup AND add-to-account
 * share this ceremony — `verify` branches on the caller's auth). The
 * credential's Nostr identity is derived CLIENT-SIDE from the WebAuthn PRF
 * extension; the server only records the credential and never holds a key,
 * so there is no key-vault gating here. Nothing is persisted besides the
 * single-use challenge; the user handle is random opaque bytes (the account
 * is keyed by the PRF-derived pubkey, not by this handle).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, { ...RateLimitPresets.auth })

  if (!getConfig().jwt.enabled) {
    throw new ServiceUnavailableError('Passkey login is not configured')
  }

  // Body is optional for this endpoint (mirrors /api/jwt) — tolerate an
  // empty or absent body; the label is only applied at verify time anyway.
  try {
    await validateBody(request, passkeyRegistrationOptionsRequestSchema)
  } catch {
    // No body — fine.
  }

  const rp = await resolveRpContext(request)
  const handle = randomUUID()

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: `lawallet-${handle.slice(0, 8)}`,
    userID: new TextEncoder().encode(handle),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    },
    timeout: CEREMONY_TIMEOUT_MS
  })

  await storeWebAuthnChallenge({
    challenge: options.challenge,
    flow: 'REGISTER',
    userId: null,
    rpId: rp.rpId,
    origin: rp.origin
  })

  return NextResponse.json({ options })
})
