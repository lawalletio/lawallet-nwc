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
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'

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
  // the owner's primary-address wallet so the pay action can route the spend
  // through the driver registry.
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      ntag424: true,
      user: {
        include: {
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            select: {
              mode: true,
              remoteWalletId: true,
              remoteWallet: { select: { type: true, config: true, status: true } },
            },
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
    // Surface *why* the SUN was rejected (replay / stale counter / malformed /
    // key mismatch) plus the stored counter, so intermittent 400s are
    // diagnosable from logs instead of only the HTTP body. `counter value too
    // old` here means the same p/c was replayed (wallet retry, double-fetch, or
    // a retry after a failed payment, which already advanced the counter).
    logger.warn(
      {
        cardId,
        action,
        reason: ntag424Response.error,
        ctrStored: card.ntag424?.ctr ?? null
      },
      'Card scan rejected: SUN verification failed'
    )
    throw new ValidationError(ntag424Response.error)
  }

  logger.info(
    {
      cardId,
      action,
      ctrOld: ntag424Response.ctrOld,
      ctrNew: ntag424Response.ctrNew
    },
    'Card scan verified; advancing counter'
  )

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

  const primaryWallet = derivePrimaryWallet(card.user?.lightningAddresses?.[0])
  const actionCard = card.user
    ? {
        ...card,
        user: {
          ...card.user,
          remoteWallets: primaryWallet ? [primaryWallet] : [],
        },
      }
    : card

  return (await import(`./actions/${action}.ts`)).default(req, actionCard)
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
