import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'

interface CardFilters {
  paired?: boolean
  used?: boolean
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

  // Build where clause based on filters
  const where: any = {}

  if (filters.paired !== undefined) {
    if (filters.paired) {
      where.otc = { not: null }
    } else {
      where.otc = { equals: null }
    }
  }

  if (filters.used !== undefined) {
    if (filters.used) {
      where.lastUsedAt = { not: null }
    } else {
      where.lastUsedAt = { equals: null }
    }
  }

  const cards = await prisma.card.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      title: true,
      lastUsedAt: true,
      username: true,
      otc: true,
      design: {
        select: {
          id: true,
          imageUrl: true,
          description: true,
          createdAt: true
        }
      },
      ntag424: {
        select: {
          cid: true,
          k0: true,
          k1: true,
          k2: true,
          k3: true,
          k4: true,
          ctr: true,
          createdAt: true
        }
      },
      user: {
        select: {
          pubkey: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  // Transform to match Card type
  const transformedCards: Card[] = cards.map(card => ({
    id: card.id,
    design: card.design,
    ntag424: card.ntag424
      ? {
          ...card.ntag424,
          createdAt: card.ntag424.createdAt
        }
      : undefined,
    createdAt: card.createdAt,
    title: card.title || undefined,
    lastUsedAt: card.lastUsedAt || undefined,
    pubkey: card.user?.pubkey,
    username: card.username || undefined,
    otc: card.otc || undefined
  }))

  return NextResponse.json(transformedCards)
}

export async function POST(request: Request) {
  const { id, designId } = await request.json()

  const card = await prisma.card.create({
    data: {
      id,
      designId,
      title: 'New Card'
    } as any,
    select: {
      id: true,
      createdAt: true,
      title: true,
      lastUsedAt: true,
      username: true,
      otc: true,
      design: {
        select: {
          id: true,
          imageUrl: true,
          description: true,
          createdAt: true
        }
      },
      ntag424: {
        select: {
          cid: true,
          k0: true,
          k1: true,
          k2: true,
          k3: true,
          k4: true,
          ctr: true,
          createdAt: true
        }
      },
      user: {
        select: {
          pubkey: true
        }
      }
    }
  })

  // Transform to match Card type
  const transformedCard: Card = {
    id: card.id,
    design: card.design,
    createdAt: card.createdAt,
    title: card.title || undefined,
    lastUsedAt: card.lastUsedAt || undefined,
    pubkey: card.user?.pubkey,
    username: card.username || undefined,
    otc: card.otc || undefined
  }

  return NextResponse.json(transformedCard)
}
