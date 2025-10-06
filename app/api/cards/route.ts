import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { generateNtag424Values } from '@/lib/ntag424'
import { randomBytes } from 'crypto'
import { validateAdminAuth } from '@/lib/admin-auth'

interface CardFilters {
  paired?: boolean
  used?: boolean
}

export async function GET(request: Request) {
  try {
    await validateAdminAuth(request)
  } catch (response) {
    if (response instanceof NextResponse) {
      return response
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }

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
  try {
    await validateAdminAuth(request)

    const { id, designId } = await request.json()

    // Generate ntag424 values using the id as cid
    const serial = id.toUpperCase().replace(/:/g, '')
    const ntag424Values = generateNtag424Values(serial)

    // Generate random 16-byte string for otc
    const otc = randomBytes(16).toString('hex')

    // Create the ntag424 record first
    const ntag424 = await prisma.ntag424.create({
      data: ntag424Values
    })

    // Then create the card and link it to the ntag424
    const card = await prisma.card.create({
      data: {
        id: randomBytes(16).toString('hex'),
        designId,
        title: 'New Card',
        ntag424Cid: ntag424.cid, // Link to the created ntag424
        otc: otc // Set the random 16-byte string for otc
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
    }

    return NextResponse.json(transformedCard)
  } catch (error) {
    console.error('Error creating card:', error)
    return NextResponse.json(
      { status: 'ERROR', reason: 'Error creating card' },
      { status: 500 }
    )
  }
}
