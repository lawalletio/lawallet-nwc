import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyRegistrationVerifyRequestSchema } from '@/lib/validation/schemas'
import {
  consumeWebAuthnChallenge,
  serializeTransports,
  toCredentialSummary
} from '@/lib/auth/passkey'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/auth/passkey/link/verify`
 *
 * Completes the LINK ceremony: verifies the authenticator's attestation
 * against the single-use challenge minted by `link/options` and attaches the
 * new credential to the CURRENTLY authenticated user's account.
 *
 * Security invariants:
 * - The challenge row is never trusted alone — `consumeWebAuthnChallenge`
 *   re-binds it to the user authenticated on THIS request
 *   (`expectedUserId`), so a challenge minted for account A can never attach
 *   a passkey to account B.
 * - Only the credential is created. The server NEVER holds a linked user's
 *   Nostr key — no ManagedNostrKey row is written on this path (custody
 *   stays with the user; that's what distinguishes 'linked' from 'managed').
 * - Every verification failure surfaces as the same generic 401 — no oracle.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.auth,
    identifier: 'passkey-link:' + auth.pubkey
  })

  const user = await resolveAccountByPubkey(auth.pubkey)
  if (!user) throw new NotFoundError('User not found')

  const body = await validateBody(request, passkeyRegistrationVerifyRequestSchema)

  const row = await consumeWebAuthnChallenge(body.challenge, 'LINK', {
    expectedUserId: user.id
  })

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential as unknown as RegistrationResponseJSON,
      expectedChallenge: row.challenge,
      expectedOrigin: row.origin,
      expectedRPID: row.rpId,
      requireUserVerification: true
    })
  } catch {
    throw new AuthenticationError('Passkey verification failed')
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthenticationError('Passkey verification failed')
  }

  const info = verification.registrationInfo

  let created
  try {
    created = await prisma.passkeyCredential.create({
      data: {
        id: info.credential.id,
        userId: user.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: serializeTransports(info.credential.transports),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid || null,
        label: body.label ?? null,
        rpId: row.rpId
      }
    })
  } catch (err) {
    // The credential id is the primary key — a re-registered authenticator
    // maps to P2002. Surface as 409 so the UI can explain instead of
    // parsing error strings.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError('This passkey is already registered')
    }
    throw err
  }

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.PASSKEY_LINKED,
    level: 'INFO',
    message: `Passkey linked for ${auth.pubkey.slice(0, 8)}…`,
    userId: user.id,
    metadata: { credentialId: created.id }
  })

  return NextResponse.json(
    { credential: toCredentialSummary(created) },
    { status: 201 }
  )
})
