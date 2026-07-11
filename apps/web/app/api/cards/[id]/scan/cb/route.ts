import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyNtag424FromPC } from '@/lib/ntag424'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import {
  cardScanActionSchema,
  scanCardQuerySchema
} from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import pay from './actions/pay'
import newOTC from './actions/new-otc'

const actionHandlers = {
  pay,
  'new-otc': newOTC
} as const

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

    const { p, c } = validateQuery(req.url, scanCardQuerySchema)
    const actionResult = cardScanActionSchema.safeParse(
      req.headers.get('LAWALLET_ACTION') || 'pay'
    )
    if (!actionResult.success) {
      throw new ValidationError('Unsupported card action')
    }
    const action = actionResult.data

    logger.info({ cardId, action }, 'Card scan callback request')

    // Only fetch fields needed to authenticate and route this spend. In
    // particular, no card design or owner presentation data is on the hot path.
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        blockedAt: true,
        disabledAt: true,
        ntag424Cid: true,
        ntag424: {
          select: { cid: true, k1: true, k2: true, ctr: true }
        },
        remoteWallet: {
          select: { id: true, type: true, config: true, status: true }
        },
        user: {
          select: {
            lightningAddresses: {
              where: { isPrimary: true },
              take: 1,
              select: {
                remoteWallet: {
                  select: { id: true, type: true, config: true, status: true }
                }
              }
            }
          }
        }
      }
    })

    if (!card) throw new NotFoundError('Card not found')
    if (card.blockedAt !== null) throw new ValidationError('Card is blocked')
    if (card.disabledAt !== null) throw new ValidationError('Card is disabled')
    if (!card.ntag424 || !card.ntag424Cid) {
      throw new ValidationError('Card is not paired')
    }

    // Authentication is deliberately read-only. Each action atomically claims
    // this counter together with its own durable state mutation.
    const ntag424Response = await verifyNtag424FromPC(card.ntag424, p, c)

    if ('error' in ntag424Response) {
      logger.warn(
        {
          cardId,
          action,
          reason: ntag424Response.error,
          ctrStored: card.ntag424.ctr
        },
        'Card scan rejected: SUN verification failed'
      )
      throw new ValidationError(ntag424Response.error)
    }

    logger.info(
      {
        cardId,
        action,
        ctrStored: card.ntag424.ctr,
        ctrNew: ntag424Response.ctrNew
      },
      'Card scan authenticated'
    )

    return actionHandlers[action](req, card, ntag424Response.ctrNew)
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
