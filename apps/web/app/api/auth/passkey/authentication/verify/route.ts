import { NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyAuthenticationVerifyRequestSchema } from '@/lib/validation/schemas'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getRolePermissions } from '@/lib/auth/permissions'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  consumeWebAuthnChallenge,
  mintPasskeySessionJwt,
  toWebAuthnCredential,
  PASSKEY_SESSION_EXPIRES_IN
} from '@/lib/auth/passkey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every failure path returns this exact message — unknown credential, bad
 * signature, wrong origin/rpID, burned challenge, counter regression. A
 * uniform 401 gives attackers no oracle to distinguish "credential exists"
 * from "signature invalid".
 */
const GENERIC_FAILURE = 'Passkey verification failed'

/**
 * `POST /api/auth/passkey/authentication/verify`
 *
 * Unauthenticated second leg of a passkey login. Consumes the single-use
 * LOGIN challenge, verifies the WebAuthn assertion against the stored
 * credential, applies signature-counter clone detection, and mints a
 * passkey session JWT (`amr: ['webauthn']`, `cred`, `custody`,
 * `auth_time`) identical in base shape to `POST /api/jwt`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('Server configuration error')
  }

  const body = await validateBody(
    request,
    passkeyAuthenticationVerifyRequestSchema
  )

  // Single-use: the row is deleted on read, so a replayed verify request
  // burns nothing and fails generically.
  const row = await consumeWebAuthnChallenge(body.challenge, 'LOGIN')

  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: body.credential.id },
    include: { user: true }
  })

  if (!credential) {
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.USER_AUTH_FAILED,
      level: 'WARN',
      message: 'Passkey login attempted with an unknown credential',
      metadata: { method: 'passkey', reason: 'unknown_credential' }
    })
    throw new AuthenticationError(GENERIC_FAILURE)
  }

  let verified = false
  let newCounter = 0
  try {
    const verification = await verifyAuthenticationResponse({
      response: body.credential as unknown as AuthenticationResponseJSON,
      expectedChallenge: row.challenge,
      expectedOrigin: row.origin,
      expectedRPID: row.rpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true
    })
    verified = verification.verified
    newCounter = verification.authenticationInfo.newCounter
  } catch {
    verified = false
  }

  if (!verified) {
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.USER_AUTH_FAILED,
      level: 'WARN',
      message: 'Passkey assertion failed verification',
      userId: credential.userId,
      metadata: { method: 'passkey', reason: 'verification_failed' }
    })
    throw new AuthenticationError(GENERIC_FAILURE)
  }

  // Clone detection: a signature counter that fails to advance means a
  // cloned authenticator may be replaying. Authenticators that never
  // increment (counter permanently 0 — common for platform passkeys) are
  // exempt via the `stored > 0` guard.
  const stored = Number(credential.counter)
  if (stored > 0 && newCounter <= stored) {
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.PASSKEY_COUNTER_REGRESSION,
      level: 'WARN',
      message: 'Passkey signature counter regression — possible cloned authenticator',
      userId: credential.userId,
      metadata: { credentialId: credential.id, stored, newCounter }
    })
    throw new AuthenticationError(GENERIC_FAILURE)
  }

  // The counter write, role resolution, and custody lookup are independent —
  // run them together rather than three serial round trips on the login path.
  const [, role, managed] = await Promise.all([
    prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() }
    }),
    resolveRole(credential.user.pubkey),
    prisma.managedNostrKey.findUnique({ where: { userId: credential.userId } })
  ])
  const permissions = getRolePermissions(role)
  const custody = managed ? 'managed' : 'linked'

  const token = mintPasskeySessionJwt({
    pubkey: credential.user.pubkey,
    role,
    permissions,
    credentialId: credential.id,
    custody,
    authTime: Math.floor(Date.now() / 1000),
    secret: config.jwt.secret
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_JWT_ISSUED,
    message: `Passkey login for ${credential.user.pubkey.slice(0, 8)}… (role=${role})`,
    userId: credential.userId,
    metadata: { pubkey: credential.user.pubkey, role, method: 'passkey' }
  })

  return NextResponse.json({
    token,
    expiresIn: PASSKEY_SESSION_EXPIRES_IN,
    type: 'Bearer',
    pubkey: credential.user.pubkey,
    custody
  })
})
