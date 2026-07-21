import { NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError,
  NotFoundError
} from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyNsecExportRequestSchema } from '@/lib/validation/schemas'
import {
  consumeWebAuthnChallenge,
  toWebAuthnCredential
} from '@/lib/auth/passkey'
import { decryptNsec, VaultDecryptError } from '@/lib/auth/key-vault'
import { hexToNsec } from '@/lib/nostr'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `POST /api/auth/passkey/nsec/export`
 *
 * Completes the step-up ceremony and releases the custodied nsec in NIP-19
 * form. This is the single most sensitive endpoint in the system: it requires
 * a fresh `EXPORT`-flow WebAuthn assertion (single-use challenge, bound to
 * the authenticated user), verifies it against a credential the user owns,
 * and always logs `NSEC_EXPORTED` at WARN.
 *
 * Every verification failure throws the same generic 401 — no oracle about
 * which step failed. The response is a SECRET — `force-dynamic`, never cached.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'nsec-export:' + auth.pubkey
  })

  const user = await resolveAccountByPubkey(auth.pubkey)
  if (!user) throw new NotFoundError('User not found')

  const body = await validateBody(request, passkeyNsecExportRequestSchema)

  // Single-use, EXPORT-flow-only, bound to this user. A LOGIN challenge can
  // never unlock an export.
  const row = await consumeWebAuthnChallenge(body.challenge, 'EXPORT', {
    expectedUserId: user.id
  })

  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: body.credential.id }
  })
  if (!credential || credential.userId !== user.id) {
    throw new AuthenticationError('Passkey verification failed')
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential as unknown as AuthenticationResponseJSON,
      expectedChallenge: row.challenge,
      expectedOrigin: row.origin,
      expectedRPID: row.rpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true
    })
  } catch {
    throw new AuthenticationError('Passkey verification failed')
  }
  if (!verification.verified) {
    throw new AuthenticationError('Passkey verification failed')
  }

  const { newCounter } = verification.authenticationInfo
  const storedCounter = Number(credential.counter)
  if (storedCounter > 0 && newCounter <= storedCounter) {
    // Possible cloned authenticator — refuse and flag for operators.
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.PASSKEY_COUNTER_REGRESSION,
      level: 'WARN',
      message: `Passkey signature counter did not increase during nsec export (${credential.id.slice(0, 8)}…)`,
      userId: user.id,
      metadata: {
        credentialId: credential.id,
        storedCounter,
        newCounter
      }
    })
    throw new AuthenticationError('Passkey verification failed')
  }

  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() }
  })

  const key = await prisma.managedNostrKey.findUnique({
    where: { userId: user.id }
  })
  if (!key) throw new NotFoundError('No managed key for this account')

  let hex: string
  try {
    hex = decryptNsec(key.ciphertext, user.id)
  } catch (error) {
    if (error instanceof VaultDecryptError) {
      logger.error(
        { userId: user.id },
        'key vault secret does not decrypt stored envelope — check KEY_VAULT_SECRET_PREVIOUS'
      )
      throw new InternalServerError('Server configuration error')
    }
    throw error
  }

  await prisma.managedNostrKey.update({
    where: { userId: user.id },
    data: { exportedAt: new Date() }
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.NSEC_EXPORTED,
    level: 'WARN',
    message: `Custodied nsec exported by ${user.primaryPubkey.slice(0, 8)}… after passkey step-up`,
    userId: user.id,
    metadata: { credentialId: credential.id }
  })

  return NextResponse.json({
    nsec: hexToNsec(hex),
    // The managed nsec derives the account's primary pubkey — return that
    // even when the session authenticated with a secondary identity.
    pubkey: user.primaryPubkey
  })
})
