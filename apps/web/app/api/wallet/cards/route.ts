import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/cards
 *
 * List the *authenticated caller's own* cards — the ones paired to them, i.e.
 * `Card.userId === caller`. ANY authenticated role can read their own cards,
 * unlike the admin-scoped /api/cards (gated on `CARDS_READ`) which returns
 * every card on the instance.
 *
 * The Connection Map and the user-facing Cards view read this so a plain user
 * (or an admin) sees exactly the cards paired to themselves. The response shape
 * mirrors /api/cards — minus the NTAG424 keys, which never leave the server
 * outside the programming/reset endpoints.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey } = await authenticate(request)

  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new NotFoundError('User not found')

  const cards = await prisma.card.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      createdAt: true,
      title: true,
      lastUsedAt: true,
      username: true,
      otc: true,
      remoteWalletId: true,
      kind: true,
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
          ctr: true,
          createdAt: true
        }
      },
      user: {
        select: {
          pubkey: true,
          // The card's identity is the owner's primary lightning address,
          // resolved through the `userId` relation — NOT the denormalized
          // `Card.username` (which no flow ever writes).
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            select: { username: true }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  const transformed: Card[] = cards.map(card => ({
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
    username: card.user?.lightningAddresses?.[0]?.username || undefined,
    otc: card.otc || undefined,
    remoteWalletId: card.remoteWalletId ?? null,
    kind: card.kind
  }))

  return NextResponse.json(transformed)
})
