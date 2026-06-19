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

/** Builds the wallet-side activation URL a wallet scans for `tokenId`. */
export function buildActivationUrl(baseUrl: string, tokenId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/wallet/activate/${tokenId}`
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

/**
 * Unassigns a card from any user — clears the holder (`userId`), the
 * lightning-address link (`username`), and the bound wallet (`remoteWalletId`),
 * plus the NTAG424's own `userId` link.
 *
 * Called whenever a card's keys are exported for (re)programming or reset
 * (`/write`, `/wipe`): once the physical card's secrets have been handed out it
 * can no longer be safely tied to a user. Idempotent — clearing already-null
 * fields is a no-op, so repeated key exports stay harmless.
 */
export async function unpairCard(
  tx: Prisma.TransactionClient,
  cardId: string,
  ntag424Cid?: string | null,
) {
  await tx.card.update({
    where: { id: cardId },
    data: { userId: null, username: null, remoteWalletId: null },
  })
  if (ntag424Cid) {
    await tx.ntag424.update({
      where: { cid: ntag424Cid },
      data: { userId: null },
    })
  }
}

/**
 * **Blocks** a card: unpairs it (like {@link unpairCard}) and stamps
 * `blockedAt`. Called when the card's NTAG424 keys are exported for *reset*
 * (the `/wipe` flow) — once those keys are out, the card is decommissioned and
 * can never be re-paired, activated, or programmed again; it can only be
 * re-wiped (the reset keys stay re-fetchable) until an operator explicitly
 * deletes it. Idempotent: `blockedAt` is preserved across repeated wipes so the
 * "blocked since" timestamp reflects the first export.
 */
export async function blockCard(
  tx: Prisma.TransactionClient,
  cardId: string,
  ntag424Cid: string | null | undefined,
  currentBlockedAt: Date | null,
) {
  await tx.card.update({
    where: { id: cardId },
    data: {
      userId: null,
      username: null,
      remoteWalletId: null,
      blockedAt: currentBlockedAt ?? new Date(),
    },
  })
  if (ntag424Cid) {
    await tx.ntag424.update({
      where: { cid: ntag424Cid },
      data: { userId: null },
    })
  }
}
