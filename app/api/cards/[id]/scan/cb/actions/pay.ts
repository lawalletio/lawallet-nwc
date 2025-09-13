import { Card } from '@/types'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { User } from '@/types/user'
import { LN } from '@getalby/sdk'
import { NextRequest, NextResponse } from 'next/server'

export default async function pay(
  req: NextRequest,
  card: Card & { user?: User }
) {
  const pr = req.nextUrl.searchParams.get('pr') || ''

  if (!pr) {
    return NextResponse.json(
      { status: 'ERROR', reason: 'Missing required parameter: pr' },
      { headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  // Check if it has nwc set up
  if (!card.user?.nwc) {
    return NextResponse.json(
      { status: 'ERROR', reason: 'NWC not setup' },
      { headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  // Get NWC URI from the user
  if (!card.user?.nwc) {
    console.error('User NWC not configured for card:', card.id)
    return NextResponse.json(
      {
        status: 'ERROR',
        reason: 'User payment service not configured'
      },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  try {
    const ln = new LN(card.user.nwc)
    console.log('Processing payment request:', pr)
    const payment = await ln.pay(pr)
    console.log('Payment successful:', payment)
  } catch (error) {
    console.error('Payment failed:', error)
    return NextResponse.json(
      {
        status: 'ERROR',
        reason:
          error instanceof Error ? error.message : 'Payment processing failed'
      },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
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
