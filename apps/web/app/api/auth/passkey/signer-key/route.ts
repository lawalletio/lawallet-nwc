import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getConfig } from '@/lib/config'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError,
  NotFoundError
} from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateJwtFromRequest } from '@/lib/jwt'
import { decryptNsec, VaultDecryptError } from '@/lib/auth/key-vault'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `GET /api/auth/passkey/signer-key`
 *
 * Releases the server-custodied Nostr private key (hex) to a live passkey
 * session so the client can construct an in-memory signer. Bearer-only, and
 * deliberately stricter than `authenticate()`: the JWT must carry the
 * passkey-specific claims (`amr: ['webauthn']` + `cred`) minted by the
 * WebAuthn login/refresh flow — an ordinary NIP-98-exchanged JWT or a QR
 * device token can never unlock key material.
 *
 * The `cred` claim is re-checked against a live `PasskeyCredential` row on
 * every call, which makes deleting a passkey a hard revocation: a stolen or
 * forged token without a surviving credential row is useless.
 *
 * The response body is a SECRET — `force-dynamic` keeps it out of any cache.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  // Bearer-only: validate the raw JWT ourselves to reach the passkey claims.
  let payload
  try {
    const result = await validateJwtFromRequest(request, config.jwt.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })
    payload = result.payload
  } catch {
    throw new AuthenticationError('Invalid session for key access')
  }

  const amr = payload.amr
  if (
    !Array.isArray(amr) ||
    !amr.includes('webauthn') ||
    typeof payload.cred !== 'string' ||
    payload.kind === 'device'
  ) {
    throw new AuthenticationError('Invalid session for key access')
  }

  await rateLimit(request, {
    ...RateLimitPresets.auth,
    identifier: 'signer-key:' + payload.pubkey
  })

  // The credential id in the token must still exist and belong to the same
  // account — passkey deletion revokes key access immediately. Ownership is
  // compared by account id so a session minted for a secondary linked pubkey
  // still reaches its own credential.
  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: payload.cred },
    include: { user: true }
  })
  const account = await resolveAccountByPubkey(payload.pubkey)
  if (!credential || !account || credential.userId !== account.id) {
    throw new AuthenticationError('Invalid session for key access')
  }

  const key = await prisma.managedNostrKey.findUnique({
    where: { userId: credential.userId }
  })
  if (!key) {
    // Linked accounts (user brought their own nsec) have nothing to release.
    throw new NotFoundError('No managed key for this account')
  }

  let hex: string
  try {
    hex = decryptNsec(key.ciphertext, credential.userId)
  } catch (error) {
    if (error instanceof VaultDecryptError) {
      logger.error(
        { userId: credential.userId },
        'key vault secret does not decrypt stored envelope — check KEY_VAULT_SECRET_PREVIOUS'
      )
      throw new InternalServerError('Server configuration error')
    }
    throw error
  }

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.SIGNER_KEY_FETCHED,
    level: 'INFO',
    message: `Managed signer key released to passkey session (${payload.pubkey.slice(0, 8)}…)`,
    userId: credential.userId,
    metadata: { credentialId: credential.id }
  })

  return NextResponse.json({
    signerKey: hex,
    pubkey: credential.user.pubkey
  })
})
