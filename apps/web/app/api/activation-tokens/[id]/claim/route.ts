import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { idParam, claimActivationTokenSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { ConflictError, NotFoundError, ValidationError } from '@/types/server/errors'
import { createNewUser } from '@/lib/user'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'

/**
 * `POST /api/activation-tokens/[id]/claim` — claim a card via its activation QR.
 *
 * Any authenticated wallet user (NIP-98 or JWT) may claim. A brand-new pubkey is
 * upserted into a `User` on the spot (mirroring the legacy OTC activate flow),
 * which is how the wallet's "new user" path works — the client mints the nsec,
 * authenticates, and we materialise the account.
 *
 * Only `ONE_TIME` tokens exist this round: the claim **transfers** the card to
 * the claimer (`Card.userId`), binds a Remote Wallet to fund it, and **burns**
 * the token (`CLAIMED`). A second scan of a burned token returns 409.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await rateLimit(request, RateLimitPresets.sensitive)

    const { pubkey } = await authenticate(request)
    if (!pubkey) throw new ValidationError('Public key is required')

    const { id } = validateParams(await params, idParam)
    const { remoteWalletId } = await validateBody(
      request,
      claimActivationTokenSchema,
    )

    // Resolve the claimer, creating the account on first sight.
    const existing = await prisma.user.findUnique({
      where: { pubkey },
    })
    const claimer = existing ?? (await createNewUser(pubkey))
    const primaryWallet = await getPrimaryRemoteWalletForUser(claimer.id)

    const token = await prisma.cardActivationToken.findUnique({
      where: { id },
      select: {
        id: true,
        cardId: true,
        qrKind: true,
        status: true,
        expiresAt: true,
        card: { select: { blockedAt: true } },
      },
    })
    if (!token) throw new NotFoundError('Activation token not found')

    // Claimability checks (cheap, pre-transaction).
    if (token.card?.blockedAt) {
      throw new ConflictError(
        'This card has been blocked (reset keys exported) and can no longer be activated.',
      )
    }
    if (token.status === 'CLAIMED') throw new ConflictError('Already claimed')
    if (token.status !== 'PENDING') {
      throw new ConflictError('Activation token is no longer valid')
    }
    if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
      throw new ConflictError('Activation token has expired')
    }
    // FOREVER tokens can't be minted yet; reject defensively.
    if (token.qrKind !== 'ONE_TIME') {
      throw new ValidationError('Unsupported activation token kind')
    }

    // Resolve which Remote Wallet funds the card. We only ever bind an ACTIVE
    // wallet: pay-time `resolveCardWallet` treats an explicit non-ACTIVE
    // binding as `unconfigured` and will NOT fall back to the owner's default,
    // so binding a disabled/revoked wallet would silently brick the card until
    // it's manually rebound. An explicit choice must belong to the claimer and
    // be ACTIVE; otherwise fall back to their ACTIVE default, or leave the card
    // unbound (null) so normal default resolution applies at tap time.
    let nextWalletId: string | null
    if (remoteWalletId) {
      const wallet = await prisma.remoteWallet.findUnique({
        where: { id: remoteWalletId },
        select: { id: true, userId: true, status: true },
      })
      if (!wallet || wallet.userId !== claimer.id || wallet.status !== 'ACTIVE') {
        throw new ValidationError('Unknown or inactive wallet')
      }
      nextWalletId = wallet.id
    } else {
      // Only an ACTIVE primary-address wallet is a usable fallback binding.
      // Otherwise leave the card unbound so normal default resolution can
      // evaluate again at tap time.
      nextWalletId = primaryWallet?.status === 'ACTIVE' ? primaryWallet.id : null
    }

    // Atomic transfer + burn. Scoping the token update to status=PENDING and
    // asserting a row changed closes the race where two wallets claim at once.
    const updated = await prisma.$transaction(async tx => {
      const burn = await tx.cardActivationToken.updateMany({
        where: { id: token.id, status: 'PENDING' },
        data: {
          status: 'CLAIMED',
          claimedAt: new Date(),
          claimedByUserId: claimer.id,
        },
      })
      if (burn.count === 0) throw new ConflictError('Already claimed')

      return tx.card.update({
        where: { id: token.cardId },
        data: { userId: claimer.id, remoteWalletId: nextWalletId },
        select: {
          id: true,
          createdAt: true,
          title: true,
          lastUsedAt: true,
          username: true,
          remoteWalletId: true,
          kind: true,
          design: {
            select: { id: true, imageUrl: true, description: true, createdAt: true },
          },
          user: { select: { pubkey: true } },
        },
      })
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_CLAIMED,
      message: `Card ${token.cardId} claimed via ONE_TIME activation`,
      userId: claimer.id,
      metadata: {
        cardId: token.cardId,
        tokenId: token.id,
        remoteWalletId: nextWalletId,
      },
    })

    // Card preview for the confirmation screen — intentionally omits NTAG keys.
    const card: Card = {
      id: updated.id,
      design: updated.design,
      createdAt: updated.createdAt,
      title: updated.title || undefined,
      lastUsedAt: updated.lastUsedAt || undefined,
      pubkey: updated.user?.pubkey,
      username: updated.username || undefined,
      remoteWalletId: updated.remoteWalletId ?? null,
      kind: updated.kind,
    }

    return NextResponse.json({ qrKind: 'ONE_TIME', card })
  },
)
