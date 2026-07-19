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
import { isVaultConfigured } from '@/lib/auth/key-vault'
import {
  CEREMONY_TIMEOUT_MS,
  resolveRpContext,
  storeWebAuthnChallenge
} from '@/lib/auth/passkey'

export const runtime = 'nodejs'

/**
 * `POST /api/auth/passkey/registration/options`
 *
 * Starts a NEW-ACCOUNT passkey signup: mints WebAuthn registration options
 * for a brand-new managed identity. Unauthenticated — anyone may begin a
 * signup ceremony; nothing is persisted besides the single-use challenge.
 *
 * A user id is pre-allocated here (it travels as the WebAuthn user handle)
 * but NO `User` row is created until `verify` proves possession of the
 * authenticator. Abandoned ceremonies leave only an expiring challenge row.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, { ...RateLimitPresets.auth })

  if (!isVaultConfigured() || !getConfig().jwt.enabled) {
    throw new ServiceUnavailableError('Passkey signup is not configured')
  }

  // Body is optional for this endpoint (mirrors /api/jwt) — tolerate an
  // empty or absent body; the label is only applied at verify time anyway.
  try {
    await validateBody(request, passkeyRegistrationOptionsRequestSchema)
  } catch {
    // No body — fine.
  }

  const rp = await resolveRpContext(request)
  const userId = randomUUID()

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: `lawallet-${userId.slice(0, 8)}`,
    userID: new TextEncoder().encode(userId),
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
    userId,
    rpId: rp.rpId,
    origin: rp.origin
  })

  return NextResponse.json({ options })
})
