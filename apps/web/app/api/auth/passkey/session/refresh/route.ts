import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateJwtFromRequest } from '@/lib/jwt'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getRolePermissions } from '@/lib/auth/permissions'
import {
  mintPasskeySessionJwt,
  PASSKEY_MAX_SESSION_AGE_SECONDS,
  PASSKEY_SESSION_EXPIRES_IN
} from '@/lib/auth/passkey'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/auth/passkey/session/refresh`
 *
 * Re-issues a passkey session JWT before it expires. Linked-custody passkey
 * users have no Nostr signer available to run the NIP-98 `/api/jwt` refresh
 * path, so this Bearer-only endpoint is their session-continuity mechanism
 * (managed users may use it too).
 *
 * Guarantees:
 * - Only passkey session tokens qualify (`amr: ['webauthn']` + `cred` claim);
 *   NIP-98-minted JWTs and device tokens are rejected.
 * - Hard revocation: the credential row is re-checked live, so deleting a
 *   passkey immediately kills its refresh chain.
 * - The original `auth_time` is PRESERVED across refreshes and capped at
 *   `PASSKEY_MAX_SESSION_AGE_SECONDS` — past that the user must perform a
 *   full WebAuthn login again.
 * - Role/permissions/custody are re-resolved on every refresh so demotions
 *   and custody changes propagate instead of being grandfathered in.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  // 1. Validate the Bearer token directly — we need the raw passkey claims
  // (amr/cred/auth_time), which unified-auth does not surface.
  let payload
  try {
    const result = await validateJwtFromRequest(request, config.jwt.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })
    payload = result.payload
  } catch {
    throw new AuthenticationError('Invalid or expired token')
  }

  // 2. Only passkey session tokens may refresh here.
  const amr = Array.isArray(payload.amr) ? payload.amr : []
  if (
    !amr.includes('webauthn') ||
    typeof payload.cred !== 'string' ||
    payload.kind === 'device'
  ) {
    throw new AuthenticationError('Invalid session for refresh')
  }

  await rateLimit(request, {
    ...RateLimitPresets.auth,
    identifier: 'passkey-refresh:' + payload.pubkey
  })

  // 3. Hard revocation: the credential must still exist and still belong to
  // the pubkey baked into the token.
  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: payload.cred },
    include: { user: true }
  })
  if (!credential || credential.user.pubkey !== payload.pubkey) {
    throw new AuthenticationError('Session revoked')
  }

  // 4. Cap the refresh chain's total age at the original WebAuthn ceremony.
  const authTime =
    typeof payload.auth_time === 'number' ? payload.auth_time : payload.iat
  if (Math.floor(Date.now() / 1000) - authTime > PASSKEY_MAX_SESSION_AGE_SECONDS) {
    throw new AuthenticationError(
      'Session expired — sign in with your passkey again'
    )
  }

  // 5. Re-resolve authorization + custody so changes propagate.
  const role = await resolveRole(payload.pubkey)
  const permissions = getRolePermissions(role)
  const managed = await prisma.managedNostrKey.findUnique({
    where: { userId: credential.userId }
  })
  const custody = managed ? 'managed' : 'linked'

  const token = mintPasskeySessionJwt({
    userId: credential.userId,
    pubkey: payload.pubkey,
    role,
    permissions,
    credentialId: credential.id,
    custody,
    authTime,
    secret: config.jwt.secret
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.PASSKEY_SESSION_REFRESHED,
    level: 'INFO',
    message: `Passkey session refreshed for ${payload.pubkey.slice(0, 8)}…`,
    userId: credential.userId,
    metadata: { credentialId: credential.id }
  })

  return NextResponse.json({
    token,
    expiresIn: PASSKEY_SESSION_EXPIRES_IN,
    type: 'Bearer',
    pubkey: payload.pubkey,
    custody
  })
})
