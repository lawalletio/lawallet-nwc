import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { requirePaidRegistration } from '@/lib/auth/paid-registration-guard'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createWalletAddressSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  toWalletAddressDto,
  type WalletAddressDto,
} from '@/lib/wallet/wallet-address-dto'

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
  const user = await prisma.user.findUnique({
    where: { pubkey },
    include: {
      lightningAddresses: {
        include: { nwcConnection: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      nwcConnections: { where: { isPrimary: true }, take: 1 },
    },
  })

  if (!user) throw new NotFoundError('User not found')
  const primaryNwc = user.nwcConnections[0] ?? null

  const dtos: WalletAddressDto[] = user.lightningAddresses.map(addr =>
    toWalletAddressDto(addr, primaryNwc),
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

  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new AuthenticationError('User not found')

  const existing = await prisma.lightningAddress.findUnique({ where: { username } })
  if (existing) throw new ConflictError('Username is already taken')

  // Gate secondary-address creation behind paid registration. Without this
  // an authenticated user could mint unlimited free addresses via this
  // endpoint even when the operator has paid mode enabled, completely
  // bypassing the /api/invoices + preimage flow used for primary claims.
  await requirePaidRegistration(role)

  const created = await prisma.lightningAddress.create({
    data: {
      username,
      userId: user.id,
      mode: mode ?? 'DEFAULT_NWC',
      isPrimary: false,
    },
    include: { nwcConnection: true },
  })

  const primaryNwc = await prisma.nWCConnection.findFirst({
    where: { userId: user.id, isPrimary: true },
  })

  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'ADDRESS',
    event: ActivityEvent.ADDRESS_CREATED,
    message: `Lightning address created: ${created.username}`,
    userId: user.id,
    metadata: { username: created.username, mode: created.mode },
  })
  return NextResponse.json(toWalletAddressDto(created, primaryNwc), { status: 201 })
})
