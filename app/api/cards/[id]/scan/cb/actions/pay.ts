import { Card } from '@/types'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { User } from '@/types/user'
import { LN } from '@getalby/sdk'
import { NextRequest, NextResponse } from 'next/server'
import {
  InternalServerError,
  ValidationError
} from '@/types/server/errors'

export default async function pay(
  req: NextRequest,
  card: Card & { user?: User }
) {
  const pr = req.nextUrl.searchParams.get('pr') || ''

  if (!pr) {
    throw new ValidationError('Missing required parameter: pr')
  }

  // Check if it has nwc set up
  if (!card.user?.nwc) {
    throw new ValidationError('NWC not setup')
  }

  // Get NWC URI from the user
  if (!card.user?.nwc) {
    console.error('User NWC not configured for card:', card.id)
    throw new InternalServerError('User payment service not configured')
  }

  try {
    const ln = new LN(card.user.nwc)
    console.log('Processing payment request:', pr)
    const payment = await ln.pay(pr)
    console.log('Payment successful:', payment)
  } catch (error) {
    console.error('Payment failed:', error)
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
