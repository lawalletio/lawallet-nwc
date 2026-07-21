import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  WebAuthnCredential
} from '@simplewebauthn/server'
import type { PasskeyCredential, User, WebAuthnFlow } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { createJwtToken } from '@/lib/jwt'
import { Permission, Role } from '@/lib/auth/permissions'
import { resolveApiUrl } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'
import { AuthenticationError } from '@/types/server/errors'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { logger } from '@/lib/logger'

/** How long a minted WebAuthn challenge stays consumable. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** WebAuthn ceremony timeout handed to the browser (cross-device QR needs slack). */
export const CEREMONY_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Hard cap on a passkey session's total age across `session/refresh` re-issues.
 * Past it the user must perform a full WebAuthn login again.
 */
export const PASSKEY_MAX_SESSION_AGE_SECONDS = 30 * 24 * 60 * 60

/** Default lifetime of a passkey-minted session JWT (mirrors the client's NIP-98 exchange). */
export const PASSKEY_SESSION_EXPIRES_IN = '24h'

export interface RpContext {
  rpId: string
  origin: string
  rpName: string
}

/**
 * Resolves the WebAuthn Relying Party identity of this instance. Uses the same
 * source of truth as NIP-98 `u`-tag validation (`resolveApiUrl`: the admin
 * `endpoint` Setting first, Host header fallback) so passkeys and Nostr auth
 * agree on who the server is. Passkeys are cryptographically scoped to the
 * rpID — changing the instance domain invalidates existing credentials.
 */
export async function resolveRpContext(request: {
  headers: { get: (k: string) => string | null }
}): Promise<RpContext> {
  const [apiUrl, settings] = await Promise.all([
    resolveApiUrl(request),
    getSettings(['community_name'], { cache: 'hot' })
  ])
  const url = new URL(apiUrl)
  return {
    rpId: url.hostname,
    origin: url.origin,
    rpName: settings.community_name || 'LaWallet'
  }
}

/**
 * Persists a freshly generated challenge for later single-use consumption,
 * pinning the rpID/origin it was minted for. Also opportunistically purges
 * expired rows (fire-and-forget — no cron needed).
 */
export async function storeWebAuthnChallenge(params: {
  challenge: string
  flow: WebAuthnFlow
  userId?: string | null
  rpId: string
  origin: string
}): Promise<void> {
  const { challenge, flow, userId, rpId, origin } = params
  await prisma.webAuthnChallenge.create({
    data: {
      challenge,
      flow,
      userId: userId ?? null,
      rpId,
      origin,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS)
    }
  })

  prisma.webAuthnChallenge
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(err =>
      logger.warn({ err: String(err) }, 'WebAuthn challenge GC failed')
    )
}

export interface ConsumedChallenge {
  challenge: string
  flow: WebAuthnFlow
  userId: string | null
  rpId: string
  origin: string
  expiresAt: Date
}

/**
 * Atomically consumes a challenge. Single-use: the row is deleted first, so a
 * captured verify request can never be replayed, and an expired or mismatched
 * challenge is burned rather than left for retry.
 *
 * @throws {AuthenticationError} Generic message on any failure — missing,
 *   already consumed, expired, wrong flow, or wrong bound user. No oracle.
 */
export async function consumeWebAuthnChallenge(
  challenge: string,
  expectedFlow: WebAuthnFlow,
  opts?: { expectedUserId?: string }
): Promise<ConsumedChallenge> {
  let row: ConsumedChallenge
  try {
    row = await prisma.webAuthnChallenge.delete({ where: { challenge } })
  } catch {
    throw new AuthenticationError('Passkey verification failed')
  }

  if (
    row.flow !== expectedFlow ||
    row.expiresAt.getTime() < Date.now() ||
    (opts?.expectedUserId !== undefined && row.userId !== opts.expectedUserId)
  ) {
    throw new AuthenticationError('Passkey verification failed')
  }

  return row
}

/** JSON round-trip for `PasskeyCredential.transports`. */
export function parseTransports(
  raw: string | null
): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function serializeTransports(
  transports: readonly string[] | undefined
): string | null {
  return transports && transports.length ? JSON.stringify(transports) : null
}

/** Maps a stored credential row to SimpleWebAuthn's verification input. */
export function toWebAuthnCredential(row: PasskeyCredential): WebAuthnCredential {
  return {
    id: row.id,
    publicKey: new Uint8Array(row.publicKey),
    counter: Number(row.counter),
    transports: parseTransports(row.transports)
  }
}

export type PasskeyCustody = 'managed' | 'linked'

export interface MintPasskeySessionParams {
  /** Account id (`User.id`) — becomes the JWT `userId` claim. */
  userId: string
  /** The account's PRIMARY pubkey (`User.pubkey`) — the session identity. */
  pubkey: string
  role: Role
  permissions: Permission[]
  credentialId: string
  custody: PasskeyCustody
  /** Epoch seconds of the WebAuthn ceremony; preserved across refreshes. */
  authTime: number
  secret: string
  expiresIn?: string | number
}

/**
 * Mints a session JWT for a passkey login. Identical shape to `POST /api/jwt`
 * (so `authenticateJwt`/`unified-auth` need zero changes) plus passkey-specific
 * claims: `amr: ['webauthn']`, `cred` (the credential id — checked live by
 * key-releasing endpoints, making passkey deletion a hard revocation),
 * `custody`, and `auth_time` (drives the refresh-chain age cap).
 */
export function mintPasskeySessionJwt(params: MintPasskeySessionParams): string {
  const {
    userId,
    pubkey,
    role,
    permissions,
    credentialId,
    custody,
    authTime,
    secret,
    expiresIn = PASSKEY_SESSION_EXPIRES_IN
  } = params
  return createJwtToken(
    {
      userId,
      pubkey,
      role,
      permissions,
      amr: ['webauthn'],
      cred: credentialId,
      custody,
      auth_time: authTime
    },
    secret,
    {
      expiresIn,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }
  )
}

/**
 * Verifies a WebAuthn assertion against its stored credential: consumes the
 * single-use challenge (of the given flow), checks the signature, applies
 * counter clone-detection, and persists the counter/lastUsedAt bump.
 * Throws a generic AuthenticationError on ANY failure (no oracle).
 * Returns the credential row with its user — the caller decides what the
 * proof authorizes (session mint, account link, export…).
 */
export async function verifyStoredCredentialAssertion(params: {
  challenge: string
  credential: { id: string } & Record<string, unknown>
  flow: WebAuthnFlow
  expectedUserId?: string
}): Promise<PasskeyCredential & { user: User }> {
  const { challenge, credential: response, flow, expectedUserId } = params
  const GENERIC = 'Passkey verification failed'

  const row = await consumeWebAuthnChallenge(challenge, flow, {
    expectedUserId
  })

  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: response.id },
    include: { user: true }
  })
  if (!credential) throw new AuthenticationError(GENERIC)

  let verified = false
  let newCounter = 0
  try {
    const verification = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
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
  if (!verified) throw new AuthenticationError(GENERIC)

  const stored = Number(credential.counter)
  if (stored > 0 && newCounter <= stored) {
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.PASSKEY_COUNTER_REGRESSION,
      level: 'WARN',
      message:
        'Passkey signature counter regression — possible cloned authenticator',
      userId: credential.userId,
      metadata: { credentialId: credential.id, stored, newCounter }
    })
    throw new AuthenticationError(GENERIC)
  }

  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: { counter: BigInt(newCounter), lastUsedAt: new Date() }
  })

  return credential
}

/** Shape returned to clients when listing a user's passkeys. Never includes key material. */
export function toCredentialSummary(row: PasskeyCredential) {
  return {
    id: row.id,
    label: row.label,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    aaguid: row.aaguid,
    rpId: row.rpId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null
  }
}
