import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { idParam, verifyCardTapSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { verifyNtag424FromPC } from '@/lib/ntag424'

/**
 * `POST /api/cards/[id]/verify-tap` — is `{p, c}` a genuine, unspent tap of
 * this card? card-manager asks before showing a tapped card, so an edited or
 * replayed URL is rejected up front instead of passing on its card id alone.
 *
 * Same checks a payment makes (BoltCard SUN): `p` decrypts with k1 to this
 * card's UID, `c` matches the k2 CMAC, and the counter is ahead of the last
 * spent one. It does NOT advance the counter — the action that follows
 * (RECOVER) burns the tap.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticateWithPermission(
      request,
      Permission.CARDS_READ
    )
    await rateLimit(request, {
      ...RateLimitPresets.cardScan,
      identifier: `card-verify-tap:${auth.pubkey}`
    })

    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, verifyCardTapSchema)

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        ntag424: { select: { cid: true, k1: true, k2: true, ctr: true } }
      }
    })
    if (!card) throw new NotFoundError('Card not found')
    if (!card.ntag424) throw new ConflictError('This card is not paired')

    const verified = await verifyNtag424FromPC(
      card.ntag424,
      body.p.toUpperCase(),
      body.c.toUpperCase()
    )
    if ('error' in verified) {
      throw new ValidationError('Invalid card tap', verified.error)
    }
    if (verified.ctrNew <= card.ntag424.ctr) {
      throw new ConflictError('This tap was already used — tap the card again')
    }

    return NextResponse.json({ valid: true, ctr: verified.ctrNew })
  }
)
