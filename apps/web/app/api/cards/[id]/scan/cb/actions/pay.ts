import { Card } from '@/types'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { User } from '@/types/user'
import { LN } from '@getalby/sdk'
import { NextRequest, NextResponse } from 'next/server'
import {
  InternalServerError,
  ValidationError
} from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { payActionQuerySchema } from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'

export default async function pay(
  req: NextRequest,
  card: Card & { user?: User }
) {
  const { pr } = validateQuery(req.url, payActionQuerySchema)

  // Check if it has nwc set up
  if (!card.user?.nwc) {
    throw new ValidationError('NWC not setup')
  }

  // Get NWC URI from the user
  if (!card.user?.nwc) {
    logger.error({ cardId: card.id }, 'User NWC not configured for card')
    throw new InternalServerError('User payment service not configured')
  }

  try {
    const ln = new LN(card.user.nwc)
    logger.info({ cardId: card.id }, 'Processing payment request')
    const payment = await ln.pay(pr)
    logger.info({ cardId: card.id }, 'Payment successful')
  } catch (error) {
    logger.error({ err: error, cardId: card.id }, 'Payment failed')
    throw new InternalServerError('Payment processing failed', {
      details: error instanceof Error ? error.message : 'Unknown error',
      cause: error
    })
  }

  return NextResponse.json(
    {
      status: 'OK'
    } as LUD03CallbackSuccess,
    {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    }
  )
}
