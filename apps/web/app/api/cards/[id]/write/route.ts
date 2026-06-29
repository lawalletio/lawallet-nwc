import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WriteData } from '@/types/ntag424'

import { prisma } from '@/lib/prisma'
import { cardToNtag424WriteData } from '@/lib/ntag424'
import { unpairCard } from '@/lib/card-activation'
import { isWriteTokenValid } from '@/lib/card-write-token'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { resolveApiUrl } from '@/lib/public-url'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
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

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = validateParams(await params, idParam)
    const token = new URL(req.url).searchParams.get('token')
    logger.info({ cardId: id }, 'Card write data request')

    // Find card by id with related data
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

    // Replay protection: the writer must present the single-use token minted by
    // `POST /api/cards/[id]/write-token`. It is honoured only while the card is
    // still fresh (never tapped) and not yet consumed/expired. Everything else —
    // including the legacy untokenized URL — is rejected so the keys can't be
    // re-fetched and the card cloned.
    if (!isWriteTokenValid(card, token)) {
      throw new AuthorizationError(
        'A valid one-time programming token is required.'
      )
    }

    // Handing out the keys means the physical card is about to be
    // (re)programmed, so it can no longer belong to a user — unpair it. In the
    // same transaction, consume the token (clear it) so the URL is single-use.
    await prisma.$transaction(async tx => {
      await unpairCard(tx, card.id, card.ntag424!.cid)
      await tx.card.update({
        where: { id: card.id },
        data: { writeToken: null, writeTokenExpiresAt: null }
      })
    })
    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_KEYS_EXPORTED,
      message: `Card ${id} keys exported for programming — unpaired`,
      metadata: { cardId: id, endpoint: 'write' }
    })

    // The host burned into the chip's `lnurlw_base` is what the wallet hits on
    // every tap, so it must be this instance's API URL (the `endpoint` setting /
    // request host) — NOT the lightning-address `domain`, which need not serve
    // the API. Same logic as the `/scan` callback and the LUD-16 callback.
    const host = new URL(await resolveApiUrl(req)).host
    const writeData: Ntag424WriteData = cardToNtag424WriteData(
      card.ntag424,
      card.id,
      card.title,
      host
    )

    return NextResponse.json(writeData, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
