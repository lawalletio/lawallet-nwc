import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { idParam, updateWalletCardSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  clearMasterCard,
  getMasterCardId,
  setMasterCard
} from '@/lib/cards/master-card'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/wallet/cards/[id]
 *
 * Owner-scoped, exactly one action per request:
 *   - `enabled` — reversible enable/disable. This deliberately does not touch
 *     `blockedAt`, which is the terminal reset/decommission state.
 *   - `linkDefaultWallet` — bind the card to the owner's primary wallet.
 *   - `remoteWalletId` — bind the card to that wallet, or `null` to unbind.
 *     The wallet must belong to the caller and must not be REVOKED or DEAD.
 *     The Connection Map uses this so a cardholder can rebind without
 *     `cards:write`.
 *   - `kind` — promote this card to the owner's MASTER (account-recovery)
 *     card, or demote it back to SIMPLE. Promoting demotes whichever card
 *     held the designation before; at most one MASTER per holder.
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
        kind: true,
        disabledAt: true,
        blockedAt: true
      }
    })
    if (!card || card.userId !== user.id) {
      throw new NotFoundError('Card not found')
    }
    if (card.blockedAt !== null) {
      throw new ConflictError(
        body.linkDefaultWallet || body.remoteWalletId !== undefined
          ? 'Blocked cards cannot be linked to a wallet'
          : body.kind !== undefined
            ? 'Blocked cards cannot be used as the master card'
            : 'Blocked cards cannot be enabled or disabled'
      )
    }

    // `undefined` means this request is not a wallet write (kind / enabled).
    // `null` unbinds. A string binds to that wallet after ownership checks.
    let nextWalletId: string | null | undefined
    if (body.remoteWalletId !== undefined) {
      if (body.remoteWalletId === null) {
        nextWalletId = null
      } else {
        const wallet = await prisma.remoteWallet.findUnique({
          where: { id: body.remoteWalletId },
          select: { id: true, userId: true, status: true }
        })
        if (
          !wallet ||
          wallet.status === 'REVOKED' ||
          wallet.status === 'DEAD'
        ) {
          throw new ValidationError('Unknown wallet')
        }
        if (wallet.userId !== user.id) {
          throw new ValidationError('Wallet does not belong to the card owner')
        }
        nextWalletId = wallet.id
      }
    } else if (body.linkDefaultWallet === true) {
      if (!defaultRemoteWalletId) {
        throw new ConflictError('No primary remote wallet configured')
      }
      nextWalletId = defaultRemoteWalletId
    }

    // The master designation is a sibling-affecting write, so it runs in its
    // own transaction (demote-then-promote) before the row is re-read below.
    let previousMasterCardId: string | null = null
    if (body.kind !== undefined) {
      previousMasterCardId = await prisma.$transaction(async tx => {
        if (body.kind === 'MASTER') {
          const result = await setMasterCard(user.id, id, tx)
          return result.previousMasterCardId
        }
        await clearMasterCard(id, tx)
        return null
      })
    }

    const updated = await prisma.card.update({
      where: { id },
      data:
        body.kind !== undefined
          ? {}
          : nextWalletId !== undefined
            ? { remoteWalletId: nextWalletId }
            : {
                disabledAt: body.enabled ? null : (card.disabledAt ?? new Date())
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

    if (body.kind !== undefined) {
      if (body.kind !== card.kind) {
        logActivity.fireAndForget({
          category: 'CARD',
          event:
            body.kind === 'MASTER'
              ? ActivityEvent.CARD_MASTER_SET
              : ActivityEvent.CARD_MASTER_CLEARED,
          message:
            body.kind === 'MASTER'
              ? `Card ${id} set as master card`
              : `Card ${id} is no longer the master card`,
          userId: user.id,
          metadata: { cardId: id, previousMasterCardId }
        })
      }
    } else if (nextWalletId !== undefined) {
      if (nextWalletId !== card.remoteWalletId) {
        logActivity.fireAndForget({
          category: 'CARD',
          event: nextWalletId
            ? ActivityEvent.CARD_WALLET_BOUND
            : ActivityEvent.CARD_WALLET_UNBOUND,
          message: nextWalletId
            ? `Card ${id} bound to wallet ${nextWalletId}`
            : `Card ${id} unbound from wallet`,
          userId: user.id,
          metadata: {
            cardId: id,
            previousRemoteWalletId: card.remoteWalletId,
            remoteWalletId: nextWalletId
          }
        })
        if (nextWalletId) {
          logActivity.fireAndForget({
            category: 'NWC',
            event: ActivityEvent.NWC_ASSIGNED_TO_CARD,
            message: `Wallet assigned to card ${id}`,
            userId: user.id,
            metadata: { cardId: id, remoteWalletId: nextWalletId }
          })
        }
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
      masterCardId: await getMasterCardId(user.id),
      blocked: updated.blockedAt !== null,
      disabled: updated.disabledAt !== null
    }

    return NextResponse.json(transformed)
  }
)
