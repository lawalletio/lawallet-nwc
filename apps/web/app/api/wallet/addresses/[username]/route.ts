import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { Permission, hasPermission } from '@/lib/auth/permissions'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  walletAddressUsernameParam,
  updateWalletAddressSchema,
} from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { toWalletAddressDto } from '@/lib/wallet/wallet-address-dto'
import { resolveWalletRoute } from '@/lib/wallet/resolve-payment-route'
import type { RemoteWallet } from '@/lib/generated/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * RemoteWallets the address-detail picker can bind to. Excludes REVOKED
 * (manual soft-delete) and DEAD (archived disposable wallets) — neither can
 * be assigned to anything.
 */
function selectableWallets(userId: string): Promise<RemoteWallet[]> {
  return prisma.remoteWallet.findMany({
    where: { userId, status: { notIn: ['REVOKED', 'DEAD'] } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
}

/** Non-sensitive RemoteWallet summary for the detail picker / read-only view. */
function toWalletSummary(w: RemoteWallet) {
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    isDefault: w.isDefault,
  }
}

/**
 * GET /api/wallet/addresses/[username]
 *
 * Owner path: returns the address plus the caller's selectable RemoteWallets
 * (so the edit page can render a CUSTOM_NWC picker without a second round-trip)
 * and the resolved connection URI for the balance / transaction widgets.
 *
 * Admin path: a caller who holds ADDRESSES_READ but does NOT own the address
 * gets a read-only view of any user's address, so admins can inspect routing
 * config from a single page. The owner's wallet *secret*
 * (`effectiveConnectionString`) is withheld — only mode/config and the
 * non-sensitive wallet summaries are returned. `isOwner` tells the client
 * which mode it's in. Anyone without the permission gets the same 404 the
 * owner-only path returns, so a plain user can't probe which usernames exist.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const auth = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)

    const address = await prisma.lightningAddress.findUnique({
      where: { username },
      include: { remoteWallet: true, user: { select: { pubkey: true } } },
    })
    if (!address) {
      throw new NotFoundError('Address not found')
    }

    const caller = await prisma.user.findUnique({
      where: { pubkey: auth.pubkey },
      select: { id: true },
    })
    const isOwner = !!caller && caller.id === address.userId

    if (!isOwner) {
      // A device token's `scopes` are authoritative; everyone else derives
      // permissions from their role. Mirror `authenticateWithPermission`.
      const canRead = auth.scopes
        ? auth.scopes.includes(Permission.ADDRESSES_READ)
        : hasPermission(auth.role, Permission.ADDRESSES_READ)
      // Same 404 as a genuine miss so non-admins can't enumerate usernames.
      if (!canRead) throw new NotFoundError('Address not found')

      const wallets = await selectableWallets(address.userId)
      const defaultWallet = wallets.find(w => w.isDefault) ?? null

      return NextResponse.json({
        address: toWalletAddressDto(address, defaultWallet),
        wallets: wallets.map(toWalletSummary),
        // The connection URI is the owner's wallet secret — never surfaced to
        // an admin viewing someone else's address.
        effectiveConnectionString: null,
        isOwner: false,
        ownerPubkey: address.user.pubkey,
      })
    }

    const wallets = await selectableWallets(caller.id)
    const defaultWallet = wallets.find(w => w.isDefault) ?? null

    // Ship the already-resolved connection URI so the balance / transactions
    // widgets don't duplicate the server's resolution. Null for IDLE / ALIAS
    // / unconfigured — the UI renders an empty state in those cases. This is
    // the owner's own wallet secret, returned only to the owner.
    const route = resolveWalletRoute({
      mode: address.mode,
      redirect: address.redirect,
      remoteWallet: address.remoteWallet,
      defaultRemoteWallet: defaultWallet,
    })
    const effectiveConnectionString =
      route.kind === 'wallet'
        ? ((route.config as { connectionString?: string } | null)?.connectionString ?? null)
        : null

    return NextResponse.json({
      address: toWalletAddressDto(address, defaultWallet),
      wallets: wallets.map(toWalletSummary),
      effectiveConnectionString,
      isOwner: true,
      ownerPubkey: auth.pubkey,
    })
  },
)

/**
 * PUT /api/wallet/addresses/[username]
 *
 * Updates the mode + mode-specific fields on a single address. Uses PUT
 * (not PATCH) because the shared `apiClient` only exposes get/post/put/del.
 *
 * Cross-field rules enforced here (not in Zod, so the schema stays a plain
 * shape compatible with `validateBody`):
 *   - ALIAS       → `redirect` must be present.
 *   - CUSTOM_NWC  → `remoteWalletId` must be present AND owned by caller.
 *   - IDLE / DEFAULT_NWC → both fields are cleared (set NULL) regardless of
 *                          what the client sent.
 */
export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)
    const body = await validateBody(request, updateWalletAddressSchema)

    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true },
    })
    if (!user) throw new AuthenticationError('User not found')

    const existing = await prisma.lightningAddress.findUnique({ where: { username } })
    if (!existing || existing.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    let redirect: string | null = null
    let remoteWalletId: string | null = null

    if (body.mode === 'ALIAS') {
      if (!body.redirect) {
        throw new ValidationError('redirect is required when mode is ALIAS')
      }
      redirect = body.redirect
    } else if (body.mode === 'CUSTOM_NWC') {
      if (!body.remoteWalletId) {
        throw new ValidationError('remoteWalletId is required when mode is CUSTOM_NWC')
      }
      const wallet = await prisma.remoteWallet.findUnique({
        where: { id: body.remoteWalletId },
      })
      if (
        !wallet ||
        wallet.userId !== user.id ||
        wallet.status === 'REVOKED' ||
        wallet.status === 'DEAD'
      ) {
        throw new ValidationError('Unknown wallet')
      }
      remoteWalletId = wallet.id
    }

    const updated = await prisma.lightningAddress.update({
      where: { username },
      data: { mode: body.mode, redirect, remoteWalletId },
      include: { remoteWallet: true },
    })

    const defaultWallet = await prisma.remoteWallet.findFirst({
      where: { userId: user.id, isDefault: true },
    })

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })

    logActivity.fireAndForget({
      category: 'ADDRESS',
      event: ActivityEvent.ADDRESS_UPDATED,
      message: `Address ${updated.username} settings updated (mode=${updated.mode})`,
      userId: user.id,
      metadata: {
        username: updated.username,
        previousMode: existing.mode,
        mode: updated.mode,
        remoteWalletId: updated.remoteWalletId ?? null,
      },
    })

    // If the update bound a custom wallet to this address, emit a dedicated
    // NWC-category entry too — the admin panel filters by category, and the
    // "wallet assigned" action is useful to see under NWC, not only ADDRESS.
    if (
      body.mode === 'CUSTOM_NWC' &&
      updated.remoteWalletId &&
      updated.remoteWalletId !== existing.remoteWalletId
    ) {
      logActivity.fireAndForget({
        category: 'NWC',
        event: ActivityEvent.NWC_ASSIGNED_TO_ADDRESS,
        message: `Wallet assigned to ${updated.username}`,
        userId: user.id,
        metadata: {
          username: updated.username,
          remoteWalletId: updated.remoteWalletId,
        },
      })
    }

    return NextResponse.json(toWalletAddressDto(updated, defaultWallet))
  },
)

/**
 * DELETE /api/wallet/addresses/[username]
 *
 * Permanently removes one of the caller's own addresses. Ownership is checked
 * the same way as GET/PUT — a non-owner (or unknown username) gets a 404 so we
 * don't reveal other users' addresses.
 *
 * If the deleted address was the user's primary and other addresses remain,
 * the oldest survivor is promoted to primary in the same transaction so the
 * account is never left with addresses but no primary. Deleting the row first
 * then promoting respects the partial-unique index (one primary per userId).
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)

    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true },
    })
    if (!user) throw new AuthenticationError('User not found')

    const existing = await prisma.lightningAddress.findUnique({ where: { username } })
    if (!existing || existing.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    const nextPrimary = existing.isPrimary
      ? await prisma.lightningAddress.findFirst({
          where: { userId: user.id, username: { not: username } },
          orderBy: { createdAt: 'asc' },
          select: { username: true },
        })
      : null

    await prisma.$transaction([
      prisma.lightningAddress.delete({ where: { username } }),
      ...(nextPrimary
        ? [
            prisma.lightningAddress.update({
              where: { username: nextPrimary.username },
              data: { isPrimary: true },
            }),
          ]
        : []),
    ])

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    // The user's primary may have shifted — bump users:updated so consumers
    // like the admin "claim your first address" banner refresh their state.
    eventBus.emit({ type: 'users:updated', timestamp: Date.now() })

    logActivity.fireAndForget({
      category: 'ADDRESS',
      event: ActivityEvent.ADDRESS_DELETED,
      message: `Lightning address deleted: ${username}`,
      userId: user.id,
      metadata: {
        username,
        wasPrimary: existing.isPrimary,
        promotedPrimary: nextPrimary?.username ?? null,
      },
    })

    return NextResponse.json({ success: true, username })
  },
)
