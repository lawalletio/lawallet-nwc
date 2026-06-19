import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { idParam, createActivationTokenSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { ConflictError, NotFoundError, ValidationError } from '@/types/server/errors'
import { resolveApiUrl } from '@/lib/public-url'
import {
  effectiveTokenStatus,
  mintActivationToken,
  resolveExpiresAt,
} from '@/lib/card-activation'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

/**
 * `POST /api/cards/[id]/activation-tokens` — mint an activation QR for a card.
 *
 * Operator-scoped (`CARDS_WRITE`); reachable by a device token carrying that
 * scope, which is how `simple-card-manager` "starts" a card. Only `ONE_TIME`
 * (ownership transfer) is wired this round — `FOREVER` (MASTER account share)
 * is rejected until that milestone lands. Minting replaces any prior active
 * token of the same kind on the card.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticateWithPermission(request, Permission.CARDS_WRITE)
    await rateLimit(request, RateLimitPresets.sensitive)

    const { id } = validateParams(await params, idParam)
    const { qrKind, expiresIn } = await validateBody(
      request,
      createActivationTokenSchema,
    )

    const card = await prisma.card.findUnique({
      where: { id },
      select: { id: true, kind: true, blockedAt: true },
    })
    if (!card) throw new NotFoundError('Card not found')

    if (card.blockedAt !== null) {
      throw new ConflictError(
        'This card has been blocked (reset keys exported) and can no longer be activated — delete it instead.',
      )
    }

    if (qrKind === 'FOREVER') {
      throw new ValidationError(
        'FOREVER activation QRs are not yet supported',
        'Account sharing (MASTER cards) is a future milestone',
      )
    }

    const expiresAt = resolveExpiresAt(expiresIn)
    // Activation links point at the wallet app, so use this instance's API
    // endpoint (or request host) — never the LUD-16 lightning-address domain.
    const url = await resolveApiUrl(request)
    // Audit-only: resolve the minting operator's user row if they have one.
    const issuer = await prisma.user.findUnique({
      where: { pubkey: auth.pubkey },
      select: { id: true },
    })

    let token
    try {
      token = await prisma.$transaction(tx =>
        mintActivationToken(tx, {
          cardId: id,
          qrKind,
          baseUrl: url,
          issuedByUserId: issuer?.id ?? null,
          expiresAt,
        }),
      )
    } catch (err) {
      // The partial unique index maps a racing concurrent mint to P2002.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictError(
          'Another active token of this kind was just issued — retry',
        )
      }
      throw err
    }

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_ACTIVATION_TOKEN_ISSUED,
      message: `Activation QR issued for card ${id} (${qrKind})`,
      userId: issuer?.id ?? undefined,
      metadata: { cardId: id, tokenId: token.id, qrKind },
    })

    return NextResponse.json(
      {
        tokenId: token.id,
        qrPayload: token.qrPayload,
        qrKind: token.qrKind,
        expiresAt: token.expiresAt,
      },
      { status: 201 },
    )
  },
)

/**
 * `GET /api/cards/[id]/activation-tokens` — list the card's currently-active
 * (PENDING, unexpired) tokens so the manager UI can show which QRs are live.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await authenticateWithPermission(request, Permission.CARDS_READ)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!card) throw new NotFoundError('Card not found')

    const now = Date.now()
    const tokens = await prisma.cardActivationToken.findMany({
      where: { cardId: id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        qrKind: true,
        qrPayload: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    })

    const active = tokens
      .map(t => ({ ...t, status: effectiveTokenStatus(t, now) }))
      .filter(t => t.status === 'PENDING')
      .map(t => ({
        tokenId: t.id,
        qrKind: t.qrKind,
        qrPayload: t.qrPayload,
        status: t.status,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      }))

    return NextResponse.json(active)
  },
)
