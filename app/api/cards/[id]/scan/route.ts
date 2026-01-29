import { nwc } from '@getalby/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03Request } from '@/types/lnurl'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const OPTIONS = withErrorHandling(async () => {
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
  const { id: cardId } = await params

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
    throw new NotFoundError('Card not found')
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
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
