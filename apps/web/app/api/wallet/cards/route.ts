import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'

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

  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')

  // Cards are scoped by the resolved account id, so the owner read and the
  // card read run together. Every card here belongs to the caller, so the
  // owner's pubkey and primary address are read once, not per card.
  const [user, cards] = await Promise.all([
    prisma.user.findUnique({
      where: { id: account.id },
      select: {
        id: true,
        pubkey: true,
        remoteWallets: {
          where: { isDefault: true, status: 'ACTIVE' },
          take: 1,
          select: { id: true }
        },
        // The card's identity is the owner's primary lightning address — NOT
        // the denormalized `Card.username` (which no flow ever writes).
        lightningAddresses: {
          where: { isPrimary: true },
          take: 1,
          select: { username: true }
        }
      }
    }),
    prisma.card.findMany({
      where: { userId: account.id },
      select: {
        id: true,
        createdAt: true,
        title: true,
        lastUsedAt: true,
        username: true,
        otc: true,
        remoteWalletId: true,
        kind: true,
        blockedAt: true,
        disabledAt: true,
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
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
  ])
  if (!user) throw new NotFoundError('User not found')

  const defaultRemoteWalletId = user.remoteWallets?.[0]?.id ?? null
  const ownerUsername = user.lightningAddresses?.[0]?.username || undefined

  // One designation per holder, so a single value covers the whole list.
  const masterCardId = cards.find(card => card.kind === 'MASTER')?.id ?? null

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
    pubkey: user.pubkey,
    username: ownerUsername,
    otc: card.otc || undefined,
    remoteWalletId: card.remoteWalletId ?? null,
    defaultRemoteWalletId,
    kind: card.kind,
    masterCardId,
    blocked: card.blockedAt !== null,
    disabled: card.disabledAt !== null
  }))

  return NextResponse.json(transformed)
})
