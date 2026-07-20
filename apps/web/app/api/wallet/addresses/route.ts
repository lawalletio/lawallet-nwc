import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { requireAddressRegistration } from '@/lib/auth/paid-registration-guard'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createWalletAddressSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  toWalletAddressDto,
  type WalletAddressDto,
} from '@/lib/wallet/wallet-address-dto'
import { resolveDefaultAddressMode } from '@/lib/wallet/default-address-mode'
import {
  derivePrimaryWallet,
  findInitialPrimaryWalletCandidate,
  getPrimaryRemoteWalletForUser,
  syncPrimaryRemoteWalletFlag,
} from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/addresses
 *
 * List the *authenticated user's own* lightning addresses, with the effective
 * NWC mode pre-derived per row. The admin endpoint at
 * /api/lightning-addresses returns the global list and is unaffected.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  const user = account
    ? await prisma.user.findUnique({
        where: { id: account.id },
        include: {
          lightningAddresses: {
            include: { remoteWallet: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      })
    : null

  if (!user) throw new NotFoundError('User not found')
  const defaultWallet = derivePrimaryWallet(
    user.lightningAddresses.find(addr => addr.isPrimary),
  )

  const dtos: WalletAddressDto[] = user.lightningAddresses.map(addr =>
    toWalletAddressDto(addr, defaultWallet),
  )
  return NextResponse.json(dtos)
})

/**
 * POST /api/wallet/addresses
 *
 * Create a new lightning address owned by the caller. Defaults to mode
 * DEFAULT_NWC and isPrimary=false. Username uniqueness is enforced by the
 * primary key on `LightningAddress.username`, so we surface a clean
 * ConflictError instead of letting a P2002 leak.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const { pubkey, role } = await authenticate(request)
  const { username, mode } = await validateBody(request, createWalletAddressSchema)

  const user = await resolveAccountByPubkey(pubkey)
  if (!user) throw new AuthenticationError('User not found')

  // Gate self-service address creation behind the instance policy. When user
  // registration is disabled only admins pass; when paid registration is on,
  // non-bypassing actors must go through /api/invoices + preimage claim.
  await requireAddressRegistration(role)

  const existing = await prisma.lightningAddress.findUnique({ where: { username } })
  if (existing) throw new ConflictError('Username is already taken')

  // A user's first/only address becomes their primary automatically — nobody
  // should end up with a single, non-primary address. Subsequent adds never
  // touch the existing primary. The DB's partial-unique index (one primary per
  // userId) makes this safe: when the count is 0 there's no primary to clash.
  const ownedCount = await prisma.lightningAddress.count({
    where: { userId: user.id },
  })
  const isPrimary = ownedCount === 0

  const created = await prisma.$transaction(async tx => {
    const primaryCandidate = isPrimary
      ? await findInitialPrimaryWalletCandidate(user.id, tx)
      : null
    const nextMode = isPrimary
      ? primaryCandidate
        ? 'CUSTOM_NWC'
        : 'IDLE'
      : mode ?? (await resolveDefaultAddressMode(user.id))

    const address = await tx.lightningAddress.create({
      data: {
        username,
        userId: user.id,
        mode: nextMode,
        remoteWalletId: primaryCandidate?.id ?? null,
        isPrimary,
      },
      include: { remoteWallet: true },
    })

    if (isPrimary) {
      await syncPrimaryRemoteWalletFlag(user.id, tx)
    }

    return address
  })

  const defaultWallet = isPrimary
    ? derivePrimaryWallet(created)
    : await getPrimaryRemoteWalletForUser(user.id)

  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  // Also bump users:updated so any mounted /api/users/me consumer (e.g.
  // the admin home banner that nudges to register a first address) drops
  // its now-stale state.
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'ADDRESS',
    event: ActivityEvent.ADDRESS_CREATED,
    message: `Lightning address created: ${created.username}`,
    userId: user.id,
    metadata: { username: created.username, mode: created.mode },
  })
  return NextResponse.json(toWalletAddressDto(created, defaultWallet), { status: 201 })
})
