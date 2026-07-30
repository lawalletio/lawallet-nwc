import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Card } from '@/types/card'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { idParam, updateCardSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  clearMasterCard,
  getMasterCardId,
  setMasterCard
} from '@/lib/cards/master-card'

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
        userId: true,
        user: {
          select: {
            pubkey: true,
            // Card identity = the owner's primary lightning address, resolved
            // through the `userId` relation (not the dead `Card.username`).
            lightningAddresses: {
              where: { isPrimary: true },
              take: 1,
              select: { username: true }
            }
          }
        }
      }
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }

    // Which of the holder's cards currently holds the MASTER designation. The
    // detail page only loads one card, so it can't derive this itself — and it
    // needs it to warn before switching.
    const masterCardId = card.userId
      ? await getMasterCardId(card.userId)
      : null

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
      username: card.user?.lightningAddresses?.[0]?.username || undefined,
      otc: card.otc || undefined,
      kind: card.kind,
      masterCardId,
      blocked: card.blockedAt !== null,
      disabled: card.disabledAt !== null
    }

    return NextResponse.json(transformedCard)
  }
)

/**
 * PATCH /api/cards/[id]
 *
 * Two independent fields, each optional:
 *   - `remoteWalletId: <id>` rebinds the card to that wallet. The wallet
 *     must be owned by the caller's user record and must not be REVOKED.
 *   - `remoteWalletId: null` unbinds; the card falls back to the owner's
 *     primary-address wallet at run-time.
 *   - `kind` promotes the card to the holder's MASTER (account-recovery)
 *     card, or demotes it back to SIMPLE. Promoting demotes whichever card
 *     held the designation before — at most one MASTER per holder.
 *
 * Cross-field validation lives here (not in Zod) for the same reason as
 * the LA PUT — the rules depend on database state, not just the body
 * shape.
 *
 * The cards routes are admin-scoped (`Permission.CARDS_WRITE`); the
 * Connection Map only shows the cards section to users with that
 * permission, so the rebind UI matches what the caller can actually do.
 * Cardholders set their own master card via `PATCH /api/wallet/cards/[id]`.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithPermission(request, Permission.CARDS_WRITE)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, updateCardSchema)

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        remoteWalletId: true,
        kind: true,
        blockedAt: true
      }
    })
    if (!card) throw new NotFoundError('Card not found')

    // ── Wallet rebind ──────────────────────────────────────────────────────
    // `remoteWalletId` is optional now that `kind` shares this endpoint, so a
    // kind-only PATCH must leave the binding alone (`undefined`, not `null`).
    const rebinding = body.remoteWalletId !== undefined
    let nextWalletId: string | null = null
    if (rebinding && body.remoteWalletId !== null) {
      const wallet = await prisma.remoteWallet.findUnique({
        where: { id: body.remoteWalletId }
      })
      // The card's owner is the wallet ownership anchor. If the card has
      // no owner yet (orphan in the inventory), only an ADMIN can be
      // hitting this endpoint anyway (CARDS_WRITE), and we let the
      // wallet match against whatever user the wallet belongs to.
      if (!wallet || wallet.status === 'REVOKED' || wallet.status === 'DEAD') {
        throw new ValidationError('Unknown wallet')
      }
      if (card.userId && wallet.userId !== card.userId) {
        throw new ValidationError('Wallet does not belong to the card owner')
      }
      nextWalletId = wallet.id
    }

    // ── Master designation ─────────────────────────────────────────────────
    let previousMasterCardId: string | null = null
    if (body.kind !== undefined) {
      // The designation is per-holder, so it needs a holder. Unpaired
      // inventory cards can still carry `kind` from creation, but it only
      // becomes a holder's master when the card is claimed.
      if (!card.userId) {
        throw new ValidationError(
          'Pair the card to a user before setting the master card'
        )
      }
      if (card.blockedAt !== null) {
        throw new ConflictError(
          'Blocked cards cannot be used as the master card'
        )
      }
      const ownerId = card.userId
      previousMasterCardId = await prisma.$transaction(async tx => {
        if (body.kind === 'MASTER') {
          const result = await setMasterCard(ownerId, id, tx)
          return result.previousMasterCardId
        }
        await clearMasterCard(id, tx)
        return null
      })
    }

    const updated = await prisma.card.update({
      where: { id },
      data: rebinding ? { remoteWalletId: nextWalletId } : {},
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
        user: { select: { pubkey: true } }
      }
    })

    eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

    // Two separate activity events so the admin Activity tab can filter
    // by category — bound/unbound under CARD, plus a sibling under NWC
    // when a binding actually changes (mirrors the LA endpoint's
    // NWC_ASSIGNED_TO_ADDRESS pattern).
    const changed = rebinding && nextWalletId !== card.remoteWalletId
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
          remoteWalletId: nextWalletId
        }
      })
      if (nextWalletId) {
        logActivity.fireAndForget({
          category: 'NWC',
          event: ActivityEvent.NWC_ASSIGNED_TO_CARD,
          message: `Wallet assigned to card ${id}`,
          userId: card.userId ?? undefined,
          metadata: { cardId: id, remoteWalletId: nextWalletId }
        })
      }
    }

    // Logged after the transaction commits, like every other switch event in
    // the codebase (see setPrimaryIdentity in lib/account/merge.ts).
    if (body.kind !== undefined && body.kind !== card.kind) {
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
        userId: card.userId ?? undefined,
        metadata: { cardId: id, previousMasterCardId }
      })
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
      kind: updated.kind,
      masterCardId: card.userId ? await getMasterCardId(card.userId) : null,
      blocked: updated.blockedAt !== null,
      disabled: updated.disabledAt !== null
    }

    return NextResponse.json(transformedCard)
  }
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
      // Serialize deletion with the payment-claim CTE, which also locks the
      // Card row before creating an attempt. Without this lock/check, deleting
      // a card can cascade-delete a PENDING attempt while its irreversible NWC
      // request is still running, losing both idempotency and transaction history.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Card"
        WHERE "id" = ${id}
        FOR UPDATE
      `
      if (!locked[0]) throw new NotFoundError('Card not found')

      const unresolvedPayment = await tx.cardPaymentAttempt.findFirst({
        where: {
          cardId: id,
          status: { in: ['PENDING', 'UNKNOWN'] }
        },
        select: { id: true }
      })
      if (unresolvedPayment) {
        throw new ConflictError(
          'Card has an unresolved payment and cannot be deleted yet'
        )
      }

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
      metadata: { cardId: id, ntag424Cid: card.ntag424Cid }
    })

    return NextResponse.json({
      message: 'Card and associated NTAG424 deleted successfully',
      cardId: id,
      ntag424Cid: card.ntag424Cid
    })
  }
)
