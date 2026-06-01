import { randomBytes } from 'crypto'
import type { Prisma } from '@/lib/generated/prisma'
import { parseDurationSeconds } from '@/lib/auth/device-token'

/**
 * QR kinds an activation token can carry.
 * - `ONE_TIME` — single-use; first claim transfers card ownership and burns it.
 * - `FOREVER` — reserved for the deferred MASTER account-share feature; the
 *   mint route rejects it for now.
 */
export type ActivationQrKind = 'ONE_TIME' | 'FOREVER'

/** A token's lifecycle status as stored on the row. */
export type ActivationTokenStatus = 'PENDING' | 'CLAIMED' | 'REVOKED' | 'EXPIRED'

/** Builds the activation URL a wallet scans for `tokenId`. */
export function buildActivationUrl(baseUrl: string, tokenId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/activate/${tokenId}`
}

/**
 * Resolves an optional `expiresIn` duration string (e.g. `24h`, `7d`) to an
 * absolute expiry, or `null` when omitted (token never expires). Throws a
 * `ValidationError` via {@link parseDurationSeconds} on an unparseable input.
 */
export function resolveExpiresAt(
  expiresIn: string | undefined,
  now: number = Date.now(),
): Date | null {
  if (!expiresIn) return null
  return new Date(now + parseDurationSeconds(expiresIn) * 1000)
}

/**
 * Effective status for display/claim checks: a `PENDING` token whose `expiresAt`
 * has passed is reported as `EXPIRED` even though the stored row still says
 * `PENDING` (we don't run a sweeper — expiry is evaluated at read time).
 */
export function effectiveTokenStatus(
  token: { status: ActivationTokenStatus; expiresAt: Date | null },
  now: number = Date.now(),
): ActivationTokenStatus {
  if (
    token.status === 'PENDING' &&
    token.expiresAt &&
    token.expiresAt.getTime() <= now
  ) {
    return 'EXPIRED'
  }
  return token.status
}

interface MintActivationTokenParams {
  cardId: string
  qrKind: ActivationQrKind
  /** Public base URL used to build the scannable qrPayload. */
  baseUrl: string
  /** DB id of the holder/operator minting the token (audit only). */
  issuedByUserId?: string | null
  expiresAt?: Date | null
}

/**
 * Mints a fresh activation token inside a transaction. Any prior `PENDING`
 * token of the same kind on the card is `REVOKED` first so the "at most one
 * active token per (cardId, qrKind)" partial unique index holds — and so a
 * concurrent mint surfaces as a P2002 the caller can translate to a 409.
 *
 * The token id is generated up-front so its `qrPayload` (the activation URL the
 * wallet scans) can be built before the insert, avoiding a second write.
 */
export async function mintActivationToken(
  tx: Prisma.TransactionClient,
  { cardId, qrKind, baseUrl, issuedByUserId, expiresAt }: MintActivationTokenParams,
) {
  await tx.cardActivationToken.updateMany({
    where: { cardId, qrKind, status: 'PENDING' },
    data: { status: 'REVOKED' },
  })

  const id = randomBytes(16).toString('hex')
  return tx.cardActivationToken.create({
    data: {
      id,
      cardId,
      qrKind,
      status: 'PENDING',
      qrPayload: buildActivationUrl(baseUrl, id),
      issuedByUserId: issuedByUserId ?? null,
      expiresAt: expiresAt ?? null,
    },
  })
}
