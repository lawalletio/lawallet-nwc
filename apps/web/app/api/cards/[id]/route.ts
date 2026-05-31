import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { idParam, updateCardSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await authenticateWithPermission(request, Permission.CARDS_READ)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
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

/**
 * PATCH /api/cards/[id]
 *
 * Today only the wallet binding can change:
 *   - `remoteWalletId: <id>` rebinds the card to that wallet. The wallet
 *     must be owned by the caller's user record and must not be REVOKED.
 *   - `remoteWalletId: null` unbinds; the card falls back to the owner's
 *     default wallet at run-time.
 *
 * Cross-field validation lives here (not in Zod) for the same reason as
 * the LA PUT — the rules depend on database state, not just the body
 * shape.
 *
 * The cards routes are admin-scoped (`Permission.CARDS_WRITE`); the
 * Connection Map only shows the cards section to users with that
 * permission, so the rebind UI matches what the caller can actually do.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithPermission(request, Permission.CARDS_WRITE)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, updateCardSchema)

    const card = await prisma.card.findUnique({
      where: { id },
      select: { id: true, userId: true, remoteWalletId: true },
    })
    if (!card) throw new NotFoundError('Card not found')

    let nextWalletId: string | null = null
    if (body.remoteWalletId !== null) {
      const wallet = await prisma.remoteWallet.findUnique({
        where: { id: body.remoteWalletId },
      })
      // The card's owner is the wallet ownership anchor. If the card has
      // no owner yet (orphan in the inventory), only an ADMIN can be
      // hitting this endpoint anyway (CARDS_WRITE), and we let the
      // wallet match against whatever user the wallet belongs to.
      if (!wallet || wallet.status === 'REVOKED') {
        throw new ValidationError('Unknown wallet')
      }
      if (card.userId && wallet.userId !== card.userId) {
        throw new ValidationError('Wallet does not belong to the card owner')
      }
      nextWalletId = wallet.id
    }

    const updated = await prisma.card.update({
      where: { id },
      data: { remoteWalletId: nextWalletId },
      select: {
        id: true,
        createdAt: true,
        title: true,
        lastUsedAt: true,
        username: true,
        otc: true,
        remoteWalletId: true,
        design: {
          select: { id: true, imageUrl: true, description: true, createdAt: true },
        },
        ntag424: {
          select: {
            cid: true, k0: true, k1: true, k2: true, k3: true, k4: true, ctr: true, createdAt: true,
          },
        },
        user: { select: { pubkey: true } },
      },
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

    // Two separate activity events so the admin Activity tab can filter
    // by category — bound/unbound under CARD, plus a sibling under NWC
    // when a binding actually changes (mirrors the LA endpoint's
    // NWC_ASSIGNED_TO_ADDRESS pattern).
    const changed = nextWalletId !== card.remoteWalletId
    if (changed) {
      logActivity.fireAndForget({
        category: 'CARD',
        event: nextWalletId
          ? ActivityEvent.CARD_WALLET_BOUND
          : ActivityEvent.CARD_WALLET_UNBOUND,
        message: nextWalletId
          ? `Card ${id} bound to wallet ${nextWalletId}`
          : `Card ${id} unbound from wallet`,
        userId: card.userId ?? undefined,
        metadata: {
          cardId: id,
          previousRemoteWalletId: card.remoteWalletId,
          remoteWalletId: nextWalletId,
        },
      })
      if (nextWalletId) {
        logActivity.fireAndForget({
          category: 'NWC',
          event: ActivityEvent.NWC_ASSIGNED_TO_CARD,
          message: `Wallet assigned to card ${id}`,
          userId: card.userId ?? undefined,
          metadata: { cardId: id, remoteWalletId: nextWalletId },
        })
      }
    }

    const transformedCard: Card = {
      id: updated.id,
      design: updated.design,
      ntag424: updated.ntag424
        ? { ...updated.ntag424, createdAt: updated.ntag424.createdAt }
        : undefined,
      createdAt: updated.createdAt,
      title: updated.title || undefined,
      lastUsedAt: updated.lastUsedAt || undefined,
      pubkey: updated.user?.pubkey,
      username: updated.username || undefined,
      otc: updated.otc || undefined,
      remoteWalletId: updated.remoteWalletId ?? null,
    }

    return NextResponse.json(transformedCard)
  },
)

export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await authenticateWithPermission(request, Permission.CARDS_WRITE)
    const { id } = validateParams(await params, idParam)

    // Find the card first to check if it exists and get ntag424 info
    const card = await prisma.card.findUnique({
      where: { id },
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
        where: { id }
      })

      // Delete the associated ntag424 if it exists
      if (card.ntag424Cid) {
        await tx.ntag424.delete({
          where: { cid: card.ntag424Cid }
        })
      }
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

    logActivity.fireAndForget({
      category: 'CARD',
      event: ActivityEvent.CARD_DELETED,
      message: `Card deleted (${id})`,
      metadata: { cardId: id, ntag424Cid: card.ntag424Cid },
    })

    return NextResponse.json({
      message: 'Card and associated NTAG424 deleted successfully',
      cardId: id,
      ntag424Cid: card.ntag424Cid
    })
  }
)
