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
import { createDerivedHandle, createStoredHandle } from '@/lib/passkey-handle'

export const runtime = 'nodejs'

/**
 * `POST /api/auth/passkey/registration/options`
 *
 * Starts a passkey creation ceremony (new-account signup AND add-to-account
 * share this ceremony — `verify` branches on the caller's auth). The
 * credential's Nostr identity is derived CLIENT-SIDE from the WebAuthn PRF
 * extension; the server only records the credential and never holds a key,
 * so there is no key-vault gating here. Nothing is persisted besides the
 * single-use challenge; the user handle is a tagged random handle
 * (lib/passkey-handle.ts) and the account is keyed by the PRF-derived
 * pubkey, not by this handle. With `storedPubkey` the handle is a tagged
 * stored handle instead: the passkey will protect an imported key, which
 * the client encrypts into the passkey's largeBlob.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, { ...RateLimitPresets.auth })

  if (!getConfig().jwt.enabled) {
    throw new ServiceUnavailableError('Passkey login is not configured')
  }

  // Body is optional for this endpoint (mirrors /api/jwt) — tolerate an
  // empty or absent body; the label is only applied at verify time anyway.
  // A body that is present but invalid still fails: a bad `storedPubkey`
  // must never fall back to a derived handle.
  const body = (await request.text()).trim()
  const { storedPubkey } = body
    ? await validateBody(
        new Request(request.url, { method: 'POST', body }),
        passkeyRegistrationOptionsRequestSchema
      )
    : {}

  const rp = await resolveRpContext(request)
  // Stored handles name the imported key's public key; derived handles end
  // in random bytes. Either way userName shows 4 of the trailing bytes.
  const handle = storedPubkey
    ? createStoredHandle(storedPubkey)
    : createDerivedHandle()
  const nameStart = storedPubkey ? 5 : 6

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: `lawallet-${Buffer.from(handle).toString('hex', nameStart, nameStart + 4)}`,
    userID: handle,
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
