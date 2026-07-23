import type {
  AuthenticatorTransportFuture,
  WebAuthnCredential
} from '@simplewebauthn/server'
import type { PasskeyCredential, WebAuthnFlow } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { resolveApiUrl } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'
import { AuthenticationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

/** How long a minted WebAuthn challenge stays consumable. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** WebAuthn ceremony timeout handed to the browser (cross-device QR needs slack). */
export const CEREMONY_TIMEOUT_MS = 5 * 60 * 1000

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

/** Shape returned to clients when listing a user's passkeys. Never includes key material. */
export function toCredentialSummary(row: PasskeyCredential) {
  return {
    id: row.id,
    label: row.label,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    aaguid: row.aaguid,
    rpId: row.rpId,
    // The identity this passkey derives (PRF model); null for pre-PRF rows.
    pubkey: row.pubkey ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null
  }
}
