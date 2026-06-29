import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { resolveApiUrl } from '@/lib/public-url'
import { isCardFresh, mintWriteToken } from '@/lib/card-write-token'

/**
 * `POST /api/cards/[id]/write-token` — mint a single-use, replay-protected
 * BoltCard programming URL.
 *
 * The admin card-detail modal calls this to get the tokenized `/write?token=…`
 * URL it renders as a QR. Minting is only allowed while the card is still fresh
 * (never tapped): a card already in use can't be re-programmed without letting
 * it be cloned, so we reject those with **409 Conflict**. Gated to
 * `CARDS_WRITE` to match the admin-only programming flow.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithPermission(request, Permission.CARDS_WRITE)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        id: true,
        lastUsedAt: true,
        blockedAt: true,
        ntag424: { select: { ctr: true } },
      },
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }
    if (!card.ntag424) {
      throw new ValidationError('Card does not have NTAG424 data')
    }
    if (card.blockedAt !== null) {
      throw new ConflictError(
        'This card has been blocked (reset keys exported) and can no longer be programmed — delete it instead.',
      )
    }
    if (!isCardFresh(card)) {
      throw new ConflictError(
        'This card has already been tapped and can no longer be programmed.',
      )
    }

    const { token, expiresAt } = await mintWriteToken(card.id)
    // `url` points at this instance's API (the `endpoint` setting / request
    // host), not the lightning-address `domain` — the `/write` endpoint it
    // targets is an API call the programming client must actually reach, and
    // the domain need not serve the API. Same logic as the `/scan` + LUD-16
    // callbacks and the chip's `lnurlw_base`.
    // `token` is also returned raw so a programming client bound to its own
    // `baseUrl` (e.g. the card-installer) can build a reachable
    // `<their-base>/api/cards/{id}/write?token=…` URL itself.
    const url = await resolveApiUrl(request)
    return NextResponse.json({
      token,
      url: `${url}/api/cards/${card.id}/write?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    })
  },
)
