import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    await validateAdminAuth(request)

    const card = await prisma.card.findUnique({
      where: { id: params.id },
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

    if (!card) {
      throw new NotFoundError('Card not found')
    }

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
  }
)

export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    await validateAdminAuth(request)

    // Find the card first to check if it exists and get ntag424 info
    const card = await prisma.card.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        ntag424Cid: true
      }
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }

    // Delete card and its associated ntag424 in a transaction
    await prisma.$transaction(async tx => {
      // Delete the card first (this will remove the foreign key reference)
      await tx.card.delete({
        where: { id: params.id }
      })

      // Delete the associated ntag424 if it exists
      if (card.ntag424Cid) {
        await tx.ntag424.delete({
          where: { cid: card.ntag424Cid }
        })
      }
    })

    return NextResponse.json({
      message: 'Card and associated NTAG424 deleted successfully',
      cardId: params.id,
      ntag424Cid: card.ntag424Cid
    })
  }
)
