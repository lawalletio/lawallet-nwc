import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { validateNip98 } from '@/lib/nip98'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    const { pubkey: authenticatedPubkey } = await validateNip98(request)

    const { userId } = await params

    if (!userId) {
      throw new ValidationError('User ID is required')
    }

    // Verify the user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    if (user.pubkey !== authenticatedPubkey) {
      throw new AuthorizationError('Not authorized to view this user')
    }

    // Get all cards associated with the user
    const cards = await prisma.card.findMany({
      where: {
        userId: userId
      },
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
      createdAt: card.createdAt,
      title: card.title || undefined,
      lastUsedAt: card.lastUsedAt || undefined,
      pubkey: card.user?.pubkey,
      username: card.username || undefined,
      otc: card.otc || undefined
    }))

    return NextResponse.json(transformedCards)
  }
)
