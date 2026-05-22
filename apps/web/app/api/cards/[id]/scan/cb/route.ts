// import 'websocket-polyfill'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { consumeNtag424FromPC } from '@/lib/ntag424'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { scanCardQuerySchema } from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'

// NWC URI will be fetched from the user record

export const OPTIONS = withErrorHandling(async (_req: NextRequest) => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION'
    }
  })
})

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  // Apply rate limiting for card scan callback (high volume endpoint)
  await rateLimit(req, RateLimitPresets.cardScan)

  const { id: cardId } = await params

  // Get query parameters
  const { p, c } = validateQuery(req.url, scanCardQuerySchema)
  const action = req.headers.get('LAWALLET_ACTION') || 'pay'

  logger.info({ cardId, action }, 'Card scan callback request')

  // Find card by id in database. Include the card's bound RemoteWallet and
  // the owner's default wallet so the pay action can route the spend through
  // the driver registry (#234); `user` still carries the legacy `nwc` URI as
  // a fallback for un-migrated cards.
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      ntag424: true,
      user: {
        include: {
          remoteWallets: {
            where: { isDefault: true },
            select: { type: true, config: true, status: true },
            take: 1,
          },
        },
      },
      remoteWallet: { select: { type: true, config: true, status: true } },
    }
  })

  if (!card) {
    throw new NotFoundError('Card not found')
  }

  const ntag424Response = await consumeNtag424FromPC(card!.ntag424!, p, c)

  if ('error' in ntag424Response) {
    throw new ValidationError(ntag424Response.error)
  }

  // Update lastUsedAt timestamp and ntag.ctr
  await prisma.card.update({
    where: { id: cardId },
    data: {
      lastUsedAt: new Date(),
      ntag424: {
        update: {
          ctr: ntag424Response.ctrNew
        }
      }
    }
  })

  return (await import(`./actions/${action}.ts`)).default(req, card)
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
