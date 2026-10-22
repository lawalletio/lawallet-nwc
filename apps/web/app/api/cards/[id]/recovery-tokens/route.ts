import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { Permission } from '@/lib/auth/permissions'
import { idParam, createRecoveryTokenSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { resolveApiUrl } from '@/lib/public-url'
import {
  RECOVERY_TOKEN_TTL_MS,
  mintActivationToken
} from '@/lib/card-activation'
import { verifyNtag424FromPC } from '@/lib/ntag424'
import { claimCardTap } from '@/lib/card-payments/attempts'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { logger } from '@/lib/logger'

/**
 * `POST /api/cards/[id]/recovery-tokens` — mint a RECOVER QR (card-manager).
 *
 * Claiming it moves the card holder's whole account onto whoever scans it, so
 * it takes more than `CARDS_WRITE`: the body carries the `p`/`c` SUN params
 * from a fresh physical tap, verified against the card's keys and burned
 * (counter advanced) before anything is minted. A card id alone — or a
 * replayed tap — can't produce one. The holder must allow card recovery, and
 * the card must be neither blocked nor paused. The QR lives 15 minutes and
 * supersedes any outstanding activation QR for the card.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticateWithPermission(
      request,
      Permission.CARDS_WRITE
    )
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      identifier: `card-recovery:${auth.pubkey}`
    })

    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, createRecoveryTokenSchema)
    const p = body.p.toUpperCase()
    const c = body.c.toUpperCase()

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        blockedAt: true,
        disabledAt: true,
        ntag424Cid: true,
        ntag424: { select: { cid: true, k1: true, k2: true, ctr: true } },
        user: { select: { cardRecoveryEnabled: true } }
      }
    })
    if (!card) throw new NotFoundError('Card not found')
    if (!card.userId || !card.user) {
      throw new ConflictError('This card has no owner to recover')
    }
    if (card.blockedAt !== null) {
      throw new ConflictError('This card has been blocked')
    }
    if (card.disabledAt !== null) {
      throw new ConflictError('This card is paused by its owner')
    }
    if (!card.user.cardRecoveryEnabled) {
      throw new AuthorizationError(
        'The owner turned off card recovery for this account'
      )
    }
    if (!card.ntag424 || !card.ntag424Cid) {
      throw new ConflictError('This card is not paired')
    }

    const verified = await verifyNtag424FromPC(card.ntag424, p, c)
    if ('error' in verified) {
      logger.warn(
        { cardId: id, reason: verified.error },
        'Recovery QR rejected: SUN verification failed'
      )
      throw new ValidationError(verified.error)
    }
    const claimed = await claimCardTap(id, card.ntag424Cid, verified.ctrNew)
    if (!claimed) {
      throw new ConflictError('This tap was already used — tap the card again')
    }

    const url = await resolveApiUrl(request)
    const issuer = await resolveAccountByPubkey(auth.pubkey)

    let token
    try {
      token = await prisma.$transaction(tx =>
        mintActivationToken(tx, {
          cardId: id,
          qrKind: 'ONE_TIME',
          purpose: 'RECOVER',
          recoverFromUserId: card.userId,
          baseUrl: url,
          issuedByUserId: issuer?.id ?? null,
          expiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS)
        })
      )
    } catch (err) {
      // The partial unique index maps a racing concurrent mint to P2002.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictError(
          'Another QR for this card was just issued — tap again'
        )
      }
      throw err
    }

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_RECOVERY_TOKEN_ISSUED,
      level: 'WARN',
      message: `Recovery QR issued for card ${id}`,
      userId: issuer?.id ?? undefined,
      metadata: { cardId: id, tokenId: token.id, ownerUserId: card.userId }
    })

    return NextResponse.json(
      {
        tokenId: token.id,
        qrPayload: token.qrPayload,
        qrKind: token.qrKind,
        purpose: token.purpose,
        expiresAt: token.expiresAt
      },
      { status: 201 }
    )
  }
)
