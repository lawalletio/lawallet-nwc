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
  ValidationError
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
    //
    // `isWriteTokenValid` is a non-locking pre-check against an in-memory
    // snapshot — it cheaply rejects missing/mismatched/expired tokens and
    // already-tapped/blocked cards, but it does NOT enforce single-use: two
    // concurrent requests can both read the same snapshot and both pass. The
    // single-use / mutual-exclusivity guarantee is enforced atomically by the
    // conditional compare-and-consume `updateMany` inside the transaction
    // below — that's what makes a concurrent replay fail loudly (403) instead
    // of succeeding silently and leaking the keys a second time.
    if (!isWriteTokenValid(card, token)) {
      throw new AuthorizationError(
        'A valid one-time programming token is required.'
      )
    }

    // Atomically consume the token AND unpair the card in one transaction.
    // The `where` predicate re-asserts every condition `isWriteTokenValid`
    // checked against the snapshot — `writeToken` matches the presented value,
    // is still unexpired, and the card is still fresh — against the LIVE row.
    // Under Read Committed a concurrent request that consumed the token first
    // (nulled `writeToken`) makes this `updateMany` match 0 rows, so the
    // loser throws instead of falling through to key export. The previous
    // unconditional `update({ where: { id } })` could not observe that signal
    // and let both requests return 200 with the keys.
    const fresh = await prisma.$transaction(async tx => {
      const consumed = await tx.card.updateMany({
        where: {
          id: card.id,
          writeToken: token,
          writeTokenExpiresAt: { gt: new Date() },
          lastUsedAt: null,
          blockedAt: null
        },
        data: { writeToken: null, writeTokenExpiresAt: null }
      })
      if (consumed.count === 0) {
        throw new AuthorizationError(
          'The programming token has already been consumed, expired, or the card is no longer fresh.'
        )
      }
      // Handing out the keys means the physical card is about to be
      // (re)programmed, so it can no longer belong to a user — unpair it.
      await unpairCard(tx, card.id, card.ntag424!.cid)
      // Re-read under the transaction so the keys/title come from the row we
      // just consumed the token on, not the pre-transaction snapshot.
      return tx.card.findUnique({
        where: { id: card.id },
        include: { design: true, ntag424: true }
      })
    })
    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_KEYS_EXPORTED,
      message: `Card ${id} keys exported for programming — unpaired`,
      metadata: { cardId: id, endpoint: 'write' }
    })

    // The host burned in the chip's `lnurlw_base` is what the wallet hits on
    // every tap, so it must be this instance's API URL (the `endpoint` setting /
    // request host) — NOT the lightning-address `domain`, which need not serve
    // the API. Same logic as the `/scan` callback and the LUD-16 callback.
    const host = new URL(await resolveApiUrl(req)).host
    const writeData: Ntag424WriteData = cardToNtag424WriteData(
      fresh!.ntag424!,
      id,
      fresh!.title,
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
