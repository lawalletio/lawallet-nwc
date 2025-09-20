import { nwc } from '@getalby/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03Request } from '@/types/lnurl'
import { getSettings } from '@/lib/settings'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION'
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

  // Find card by id in database
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      design: true,
      user: true
    }
  })

  if (!card) {
    return NextResponse.json(
      { error: 'Card not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }

  const { endpoint } = await getSettings(['endpoint'])

  const response = {
    tag: 'withdrawRequest',
    k1: 'k',
    minWithdrawable: 1,
    maxWithdrawable: 10000000,
    defaultDescription: 'Boltcard + NWC',
    callback: `${endpoint}/api/cards/${cardId}/scan/cb?p=${p}&c=${c}`
  } as LUD03Request

  console.dir(response)
  return NextResponse.json(response, {
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  })
}
