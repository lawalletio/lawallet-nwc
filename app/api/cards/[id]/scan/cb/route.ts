// import 'websocket-polyfill'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { LN } from '@getalby/sdk'
import { consumeNtag424FromPC } from '@/lib/ntag424'

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
  const p = searchParams.get('p') || ''
  const c = searchParams.get('c') || ''
  const action = req.headers.get('LAWALLET_ACTION') || 'pay'

  if (!p || !c) {
    return NextResponse.json(
      { status: 'ERROR', reason: 'Missing required parameters: p and c' },
      { headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  try {
    // Find card by id in database
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: {
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

    const ntag424Response = await consumeNtag424FromPC(card!.ntag424!, p, c)

    if ('error' in ntag424Response) {
      return NextResponse.json(
        { status: 'ERROR', reason: ntag424Response.error },
        { headers: { 'Access-Control-Allow-Origin': '*' } }
      )
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

    return (await import(`./actions/${action}`)).default(req, card)
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
