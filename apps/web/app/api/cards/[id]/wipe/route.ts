import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WipeData } from '@/types/ntag424'

import { prisma } from '@/lib/prisma'
import { cardToNtag424WipeData } from '@/lib/ntag424'
import { blockCard } from '@/lib/card-activation'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'

export const OPTIONS = withErrorHandling(async (_req: NextRequest) => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
})

/**
 * `GET /api/cards/:id/wipe` — reset payload for NFC programming tools.
 *
 * Returns the BoltCard "wipe" JSON (`{ action: 'wipe', k0..k4, uid }`): the
 * BoltCard NFC Card Creator app (or any compatible tool) fetches this from the
 * QR, authenticates with the card's *current* keys, and resets the NTAG424 to
 * factory defaults so the physical card can be reused.
 *
 * Mirrors {@link file://../write/route.ts}: CORS-open and unauthenticated
 * because the phone app reaches it from outside the admin's browser context.
 * The 32-hex card id is the bearer secret, exactly as for `/write`.
 */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = validateParams(await params, idParam)
    logger.info({ cardId: id }, 'Card wipe data request')

    const card = await prisma.card.findUnique({
      where: { id },
      include: {
        design: true,
        ntag424: true
      }
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }

    if (!card.ntag424) {
      throw new ValidationError('Card does not have NTAG424 data')
    }

    // Resetting hands out the card's keys, so it's being decommissioned:
    // unpair it AND mark it **blocked**. A blocked card can no longer be
    // re-paired/activated/programmed — only re-wiped (these reset keys stay
    // re-fetchable, on purpose) until an operator explicitly deletes it.
    // `blockedAt` is preserved so repeated reveals keep the first block time.
    await prisma.$transaction(tx =>
      blockCard(tx, card.id, card.ntag424!.cid, card.blockedAt)
    )
    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_KEYS_EXPORTED,
      message: `Card ${id} reset keys exported — blocked`,
      metadata: { cardId: id, endpoint: 'wipe' }
    })

    const wipeData: Ntag424WipeData = cardToNtag424WipeData(card.ntag424)

    return NextResponse.json(wipeData, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
