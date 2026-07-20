import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  InternalServerError,
  ServiceUnavailableError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyRegistrationVerifyRequestSchema } from '@/lib/validation/schemas'
import { encryptNsec, isVaultConfigured } from '@/lib/auth/key-vault'
import {
  consumeWebAuthnChallenge,
  mintPasskeySessionJwt,
  PASSKEY_SESSION_EXPIRES_IN,
  serializeTransports
} from '@/lib/auth/passkey'
import { generatePrivateKey, getPublicKeyFromPrivate } from '@/lib/nostr'
import { createNewUser } from '@/lib/user'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getRolePermissions } from '@/lib/auth/permissions'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/auth/passkey/registration/verify`
 *
 * Completes a NEW-ACCOUNT passkey signup. Verifies the authenticator's
 * attestation against the single-use challenge minted by `options`, then
 * materializes the account: a fresh server-generated Nostr identity
 * (custodied at rest in the key vault), the `User` row under the
 * pre-allocated id, and the passkey credential itself.
 *
 * The private key (`signerKey`) is returned exactly ONCE — here — so the
 * client can build its in-memory signer without a second round-trip.
 * Afterwards it is only obtainable via the signer-key/export flows.
 *
 * All verification failures throw the same generic 401 — no oracle.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, { ...RateLimitPresets.auth })

  if (!isVaultConfigured()) {
    throw new ServiceUnavailableError('Passkey signup is not configured')
  }
  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('Server configuration error')
  }

  const body = await validateBody(request, passkeyRegistrationVerifyRequestSchema)

  // Single-use: the challenge row is burned before verification.
  const row = await consumeWebAuthnChallenge(body.challenge, 'REGISTER')
  const userId = row.userId
  if (!userId) {
    // REGISTER challenges always carry the pre-allocated user id; a row
    // without one is corrupt — fail closed with the generic message.
    throw new AuthenticationError('Passkey verification failed')
  }

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

  // Server-custodied Nostr identity, generated only after the authenticator
  // proved itself. The hex key never touches logs or activity metadata.
  const privkeyHex = generatePrivateKey()
  const pubkey = getPublicKeyFromPrivate(privkeyHex)

  // Provisions wallets and logs USER_SIGNUP under the pre-allocated id.
  await createNewUser(pubkey, { userId })

  try {
    await prisma.$transaction([
      prisma.managedNostrKey.create({
        // Copy into a fresh Buffer: encryptNsec returns Buffer<ArrayBufferLike>
        // (Buffer.concat) while Prisma's Bytes wants Uint8Array<ArrayBuffer>.
        data: { userId, ciphertext: Buffer.from(encryptNsec(privkeyHex, userId)) }
      }),
      prisma.passkeyCredential.create({
        data: {
          id: info.credential.id,
          userId,
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
    ])
  } catch (err) {
    // Roll the half-created account back (cascade removes wallets, addresses
    // and any managed key). Best-effort — the vault row is what matters.
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    if ((err as { code?: string } | null)?.code === 'P2002') {
      throw new ConflictError('This passkey is already registered')
    }
    throw err
  }

  const role = await resolveRole(pubkey)
  const permissions = getRolePermissions(role)
  const token = mintPasskeySessionJwt({
    userId,
    pubkey,
    role,
    permissions,
    credentialId: info.credential.id,
    custody: 'managed',
    authTime: Math.floor(Date.now() / 1000),
    secret: config.jwt.secret
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.PASSKEY_REGISTERED,
    level: 'INFO',
    message: `Passkey registered for ${pubkey.slice(0, 8)}… (new account)`,
    userId,
    metadata: { pubkey, credentialId: info.credential.id }
  })

  return NextResponse.json({
    token,
    expiresIn: PASSKEY_SESSION_EXPIRES_IN,
    type: 'Bearer',
    pubkey,
    custody: 'managed',
    signerKey: privkeyHex
  })
})
