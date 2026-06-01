import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { NotFoundError } from '@/types/server/errors'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { mintActivationToken } from '@/lib/card-activation'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

/**
 * `POST /api/cards/[id]/rescue` — reset a lost/leaked card and re-issue a QR.
 *
 * Operator-scoped (`CARDS_WRITE`). This is the standard "re-issue" path; the
 * "rescue" wording is for when a previous QR was lost or leaked. It's a
 * **destructive reset**: all outstanding tokens are revoked, the card is
 * unassigned (holder + bound wallet cleared) per the roadmap's "fresh,
 * unassigned, no-attachments state", and a fresh `ONE_TIME` QR is minted.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticateWithPermission(request, Permission.CARDS_WRITE)
    await rateLimit(request, RateLimitPresets.sensitive)

    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!card) throw new NotFoundError('Card not found')

    const { url } = await resolvePublicEndpoint(request)
    const issuer = await prisma.user.findUnique({
      where: { pubkey: auth.pubkey },
      select: { id: true },
    })

    const token = await prisma.$transaction(async tx => {
      // Revoke every outstanding token and unassign the card. `remoteWalletId`
      // FK is SetNull-safe; clearing `userId` returns the card to inventory.
      await tx.cardActivationToken.updateMany({
        where: { cardId: id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      })
      await tx.card.update({
        where: { id },
        data: { userId: null, remoteWalletId: null },
      })
      // mintActivationToken re-runs the same-kind revoke (now a no-op) then
      // inserts the fresh PENDING token.
      return mintActivationToken(tx, {
        cardId: id,
        qrKind: 'ONE_TIME',
        baseUrl: url,
        issuedByUserId: issuer?.id ?? null,
      })
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_RESCUED,
      message: `Card ${id} rescued — fresh ONE_TIME QR issued`,
      userId: issuer?.id ?? undefined,
      metadata: { cardId: id, tokenId: token.id },
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
