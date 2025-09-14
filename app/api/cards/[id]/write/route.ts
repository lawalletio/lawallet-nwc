import { NextRequest, NextResponse } from 'next/server'
import type { Ntag424WriteData } from '@/types/ntag424'

import { prisma } from '@/lib/prisma'
import { cardToNtag424WriteData } from '@/lib/ntag424'
import { getSettings } from '@/lib/settings'

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
  { params }: { params: { id: string } }
) {
  console.log('Card ID:', params.id)

  try {
    // Find card by id with related data
    const card = await prisma.card.findUnique({
      where: { id: params.id },
      include: {
        design: true,
        ntag424: true
      }
    })

    if (!card) {
      return NextResponse.json(
        { error: 'Card not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }

    if (!card.ntag424) {
      return NextResponse.json(
        { error: 'Card does not have NTAG424 data' },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
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

    const settings = await getSettings(['domain'])
    const writeData: Ntag424WriteData = cardToNtag424WriteData(
      cardData,
      settings.endpoint.replace(/^https?:\/\//, '')
    )

    return NextResponse.json(writeData, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error fetching card:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}
