import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  walletAddressUsernameParam,
  updateWalletAddressSchema,
} from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { toWalletAddressDto } from '@/lib/wallet/wallet-address-dto'
import { resolvePaymentRoute } from '@/lib/wallet/resolve-payment-route'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/addresses/[username]
 *
 * Returns the address (must be owned by caller) plus the user's full list of
 * NWCConnections so the edit page can render a CUSTOM_NWC picker without a
 * second round-trip.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)

    // Pull the legacy `User.nwc` URI too so DEFAULT_NWC addresses on
    // accounts that haven't migrated to NWCConnection still get a balance
    // on the client. Matches the server-side LUD-16 fallback order.
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true, nwc: true },
    })
    if (!user) throw new AuthenticationError('User not found')

    const address = await prisma.lightningAddress.findUnique({
      where: { username },
      include: { nwcConnection: true },
    })
    if (!address || address.userId !== user.id) {
      // Same response either way to avoid revealing other users' addresses.
      throw new NotFoundError('Address not found')
    }

    const connections = await prisma.nWCConnection.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })
    const primaryNwc = connections.find(c => c.isPrimary) ?? null

    // Ship the already-resolved NWC URI so the balance / transactions
    // widgets don't have to duplicate (and potentially drift from) the
    // server's `resolvePaymentRoute` logic. Null for IDLE / ALIAS /
    // unconfigured — the UI renders an empty state in those cases.
    const route = resolvePaymentRoute({
      mode: address.mode,
      redirect: address.redirect,
      nwcConnection: address.nwcConnection,
      primaryNwcConnection: primaryNwc,
      userNwc: user.nwc,
    })
    const effectiveConnectionString =
      route.kind === 'nwc' ? route.connectionString : null

    return NextResponse.json({
      address: toWalletAddressDto(address, primaryNwc),
      connections: connections.map(c => ({
        id: c.id,
        connectionString: c.connectionString,
        mode: c.mode,
        isPrimary: c.isPrimary,
      })),
      effectiveConnectionString,
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
 *   - CUSTOM_NWC  → `nwcConnectionId` must be present AND owned by caller.
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
    let nwcConnectionId: string | null = null

    if (body.mode === 'ALIAS') {
      if (!body.redirect) {
        throw new ValidationError('redirect is required when mode is ALIAS')
      }
      redirect = body.redirect
    } else if (body.mode === 'CUSTOM_NWC') {
      if (!body.nwcConnectionId) {
        throw new ValidationError('nwcConnectionId is required when mode is CUSTOM_NWC')
      }
      const conn = await prisma.nWCConnection.findUnique({
        where: { id: body.nwcConnectionId },
      })
      if (!conn || conn.userId !== user.id) {
        throw new ValidationError('Unknown NWC connection')
      }
      nwcConnectionId = conn.id
    }

    const updated = await prisma.lightningAddress.update({
      where: { username },
      data: { mode: body.mode, redirect, nwcConnectionId },
      include: { nwcConnection: true },
    })

    const primaryNwc = await prisma.nWCConnection.findFirst({
      where: { userId: user.id, isPrimary: true },
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
        nwcConnectionId: updated.nwcConnectionId ?? null,
      },
    })

    // If the update assigned a custom NWC to this address, emit a dedicated
    // NWC-category entry too — the admin panel filters by category, and the
    // "custom NWC assigned" action is useful to see under NWC, not only
    // under ADDRESS.
    if (
      body.mode === 'CUSTOM_NWC' &&
      updated.nwcConnectionId &&
      updated.nwcConnectionId !== existing.nwcConnectionId
    ) {
      logActivity.fireAndForget({
        category: 'NWC',
        event: ActivityEvent.NWC_ASSIGNED_TO_ADDRESS,
        message: `Custom NWC assigned to ${updated.username}`,
        userId: user.id,
        metadata: {
          username: updated.username,
          nwcConnectionId: updated.nwcConnectionId,
        },
      })
    }

    return NextResponse.json(toWalletAddressDto(updated, primaryNwc))
  },
)
