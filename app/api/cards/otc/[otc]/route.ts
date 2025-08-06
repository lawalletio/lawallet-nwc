import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'

export async function GET(
  request: Request,
  { params }: { params: { otc: string } }
) {
  try {
    const { otc } = params

    if (!otc) {
      return NextResponse.json(
        { error: 'OTC parameter is required' },
        { status: 400 }
      )
    }

    const card = await prisma.card.findFirst({
      where: {
        otc: otc
      },
      select: {
        id: true,
        createdAt: true,
        title: true,
        lastUsedAt: true,
        username: true,
        design: {
          select: {
            id: true,
            imageUrl: true,
            description: true,
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

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    // Transform to match Card type
    const transformedCard: Card = {
      id: card.id,
      design: card.design,
      createdAt: card.createdAt,
      title: card.title || undefined,
      lastUsedAt: card.lastUsedAt || undefined,
      pubkey: card.user?.pubkey,
      username: card.username || undefined
    }

    return NextResponse.json(transformedCard)
  } catch (error) {
    console.error('Error fetching card by OTC:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
