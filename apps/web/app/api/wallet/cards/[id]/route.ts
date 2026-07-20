import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { idParam, updateWalletCardSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/wallet/cards/[id]
 *
 * Owner-scoped reversible enable/disable. This deliberately does not touch
 * `blockedAt`, which is the terminal reset/decommission state.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey } = await authenticate(request)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, updateWalletCardSchema)

    const account = await resolveAccountByPubkey(pubkey)
    const user = account
      ? await prisma.user.findUnique({
          where: { id: account.id },
          select: {
            id: true,
            remoteWallets: {
              where: { isDefault: true, status: 'ACTIVE' },
              take: 1,
              select: { id: true }
            }
          }
        })
      : null
    if (!user) throw new NotFoundError('User not found')

    const defaultRemoteWalletId = user.remoteWallets?.[0]?.id ?? null

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        remoteWalletId: true,
        disabledAt: true,
        blockedAt: true
      }
    })
    if (!card || card.userId !== user.id) {
      throw new NotFoundError('Card not found')
    }
    if (card.blockedAt !== null) {
      throw new ConflictError(
        body.linkDefaultWallet
          ? 'Blocked cards cannot be linked to a wallet'
          : 'Blocked cards cannot be enabled or disabled'
      )
    }
    if (body.linkDefaultWallet === true && !defaultRemoteWalletId) {
      throw new ConflictError('No primary remote wallet configured')
    }

    const updated = await prisma.card.update({
      where: { id },
      data:
        body.linkDefaultWallet === true
          ? { remoteWalletId: defaultRemoteWalletId }
          : {
              disabledAt: body.enabled
                ? null
                : (card.disabledAt ?? new Date())
            },
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
        },
        user: {
          select: {
            pubkey: true,
            lightningAddresses: {
              where: { isPrimary: true },
              take: 1,
              select: { username: true }
            }
          }
        }
      }
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

    if (body.linkDefaultWallet === true) {
      if (defaultRemoteWalletId !== card.remoteWalletId) {
        logActivity.fireAndForget({
          category: 'CARD',
          event: ActivityEvent.CARD_WALLET_BOUND,
          message: `Card ${id} bound to wallet ${defaultRemoteWalletId}`,
          userId: user.id,
          metadata: {
            cardId: id,
            previousRemoteWalletId: card.remoteWalletId,
            remoteWalletId: defaultRemoteWalletId
          }
        })
        logActivity.fireAndForget({
          category: 'NWC',
          event: ActivityEvent.NWC_ASSIGNED_TO_CARD,
          message: `Wallet assigned to card ${id}`,
          userId: user.id,
          metadata: { cardId: id, remoteWalletId: defaultRemoteWalletId }
        })
      }
    } else {
      const enabled = body.enabled === true
      logActivity.fireAndForget({
        category: 'CARD',
        event: ActivityEvent.CARD_STATUS_UPDATED,
        message: enabled ? `Card ${id} enabled` : `Card ${id} disabled`,
        userId: user.id,
        metadata: {
          cardId: id,
          enabled,
          previousDisabledAt: card.disabledAt?.toISOString() ?? null,
          disabledAt: updated.disabledAt?.toISOString() ?? null
        }
      })
    }

    const transformed: Card = {
      id: updated.id,
      design: updated.design,
      ntag424: updated.ntag424
        ? {
            ...updated.ntag424,
            createdAt: updated.ntag424.createdAt
          }
        : undefined,
      createdAt: updated.createdAt,
      title: updated.title || undefined,
      lastUsedAt: updated.lastUsedAt || undefined,
      pubkey: updated.user?.pubkey,
      username: updated.user?.lightningAddresses?.[0]?.username || undefined,
      otc: updated.otc || undefined,
      remoteWalletId: updated.remoteWalletId ?? null,
      defaultRemoteWalletId,
      kind: updated.kind,
      blocked: updated.blockedAt !== null,
      disabled: updated.disabledAt !== null
    }

    return NextResponse.json(transformed)
  }
)
