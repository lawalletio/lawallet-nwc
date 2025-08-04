import { NextResponse } from 'next/server'
import { mockCardData } from '@/mocks/card'
import type { Card } from '@/types/card'
import type { Ntag424 } from '@/types/ntag424'

// Helper to ensure dates are parsed
const parseDates = (card: Card): Card => {
  const ntag424: Ntag424 | undefined = card.ntag424
    ? {
        ...card.ntag424,
        createdAt: new Date(card.ntag424.createdAt)
      }
    : undefined

  return {
    ...card,
    createdAt: new Date(card.createdAt),
    lastUsedAt: card.lastUsedAt ? new Date(card.lastUsedAt) : undefined,
    ntag424
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const card = mockCardData.find(card => card.id === params.id)

  if (!card) {
    return new NextResponse('Card not found', { status: 404 })
  }

  return NextResponse.json(parseDates(card))
}
