import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WriteData } from '@/types/ntag424'

import { prisma } from '@/lib/prisma'
import { cardToNtag424WriteData } from '@/lib/ntag424'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

export const OPTIONS = withErrorHandling(async () => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
})

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    logger.info({ cardId: params.id }, 'Card write data request')

    // Find card by id with related data
    const card = await prisma.card.findUnique({
      where: { id: params.id },
      include: {
        design: true,
        ntag424: true
      }
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }

    if (!card.ntag424) {
      throw new ValidationError('Card does not have NTAG424 data')
    }

    // Transform the Prisma result to match the expected Card type
    const cardData = {
      id: card.id,
      design: card.design,
      ntag424: card.ntag424,
      createdAt: card.createdAt,
      title: card.title || undefined,
      lastUsedAt: card.lastUsedAt || undefined,
      username: card.username || undefined,
      otc: card.otc || undefined
    }

    const settings = await getSettings(['endpoint'])
    const writeData: Ntag424WriteData = cardToNtag424WriteData(
      cardData,
      settings.endpoint.replace(/^https?:\/\//, '')
    )

    return NextResponse.json(writeData, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
