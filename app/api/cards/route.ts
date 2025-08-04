import { NextResponse } from 'next/server'
import { mockCardData } from '@/mocks/card'
import { mockCardDesignData } from '@/mocks/card-design'
import type { Card } from '@/types/card'
import type { Ntag424 } from '@/types/ntag424'

interface CardFilters {
  paired?: boolean
  used?: boolean
}

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // Parse filters from query params
  const filters: CardFilters = {
    paired: searchParams.has('paired')
      ? searchParams.get('paired') === 'true'
      : undefined,
    used: searchParams.has('used')
      ? searchParams.get('used') === 'true'
      : undefined
  }

  let filteredCards = [...mockCardData]

  // Apply paired filter if defined
  if (filters.paired !== undefined) {
    filteredCards = filteredCards.filter(
      card => filters.paired === (card.ntag424 !== undefined)
    )
  }

  // Apply used filter if defined
  if (filters.used !== undefined) {
    filteredCards = filteredCards.filter(
      card => filters.used === (card.lastUsedAt !== undefined)
    )
  }

  // Parse dates before sending response
  const cardsWithParsedDates = filteredCards.map(parseDates)

  return NextResponse.json(cardsWithParsedDates)
}

export async function POST(request: Request) {
  const { id, designId } = await request.json()

  // Mock creating a new card
  const newCard: Card = {
    id,
    design:
      mockCardDesignData.find(d => d.id === designId) || mockCardDesignData[0],
    createdAt: new Date(),
    title: 'New Card'
  }

  return NextResponse.json(parseDates(newCard))
}
