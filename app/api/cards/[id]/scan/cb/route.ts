// import 'websocket-polyfill'
import { NextRequest, NextResponse } from 'next/server'
import { mockCardData } from '@/mocks/card'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { LN } from '@getalby/sdk'

const NWC_URI = process.env.NWC_URI_EXAMPLE

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

  // Find card by id
  const card = mockCardData.find(card => card.id === cardId)
  if (!card) {
    return NextResponse.json(
      { error: 'Card not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  // TODO: Implement the logic to handle the callback

  try {
    const ln = new LN(NWC_URI!)

    console.dir(pr)
    const payment = await ln.pay(pr)
  } catch (error) {
    // TODO: Handle NWC error

    console.dir(error)
    // return NextResponse.json(
    //   {
    //     status: 'ERROR',
    //     reason: error instanceof Error ? error.message : 'Unknown error'
    //   },
    //   { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    // )
  } finally {
    return NextResponse.json(
      {
        status: 'OK'
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }

  // return NextResponse.json({
  //   status: 'OK'
  // } as LUD03CallbackSuccess)
}
