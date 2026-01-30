import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { otcParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ otc: string }> }) => {
    const { otc } = validateParams(await params, otcParam)

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
      throw new NotFoundError('Card not found')
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
  }
)
