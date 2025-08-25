// import 'websocket-polyfill'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { LN } from '@getalby/sdk'

// NWC URI will be fetched from the user record

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}

export async function GET(
  req: NextRequest,
  { params: { id: cardId } }: { params: { id: string } }
) {
  // Get query parameters
  const searchParams = req.nextUrl.searchParams
  const pr = searchParams.get('pr') || ''
  const k = searchParams.get('k') || ''

  try {
    // Find card by id in database
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: {
        design: true,
        ntag424: true,
        user: true
      }
    })

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }

    // Check if it has nwc set up
    if (!card.user?.nwc) {
      return NextResponse.json(
        { status: 'ERROR', reason: 'NWC not setup' },
        { headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }

    // Update lastUsedAt timestamp
    await prisma.card.update({
      where: { id: cardId },
      data: { lastUsedAt: new Date() }
    })

    // Handle the payment if we have a payment request
    if (pr) {
      // Get NWC URI from the user
      if (!card.user?.nwc) {
        console.error('User NWC not configured for card:', cardId)
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
              error instanceof Error
                ? error.message
                : 'Payment processing failed'
          },
          { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
        )
      }
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
  } catch (error) {
    console.error('Database error:', error)
    return NextResponse.json(
      {
        status: 'ERROR',
        reason: 'Internal server error'
      },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}
