import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { eventBus } from '@/lib/events/event-bus'
import { logger } from '@/lib/logger'

/**
 * `DELETE /api/dev/cards` — wipe every card (plus its NTAG424 key material and
 * activation tokens) so the card flow can be re-tested from a clean slate.
 *
 * Allowlisted to local development: it returns 404 unless `NODE_ENV` is exactly
 * `development`, so production, test, staging, or an unset env are locked out —
 * mirroring {@link file://../reset/route.ts} and {@link file://../login/route.ts}.
 * The button that calls it is gated the same way, so this is double-gated.
 */
export const DELETE = withErrorHandling(async (_request: Request) => {
  if (process.env.NODE_ENV !== 'development') {
    throw new NotFoundError('Not found')
  }

  // Activation tokens cascade on card delete; the NTAG424 row is referenced
  // *by* the card, so delete cards first, then the now-orphaned ntag424 rows.
  const cards = await prisma.card.deleteMany()
  const ntag424 = await prisma.ntag424.deleteMany()

  logger.warn(
    `[dev] Removed ${cards.count} cards + ${ntag424.count} ntag424 via /api/dev/cards`
  )

  // Broadcast so any open /admin/cards tab refetches in real time, the same
  // way the real card mutation routes do.
  eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

  return NextResponse.json({
    deleted: { cards: cards.count, ntag424: ntag424.count }
  })
})
