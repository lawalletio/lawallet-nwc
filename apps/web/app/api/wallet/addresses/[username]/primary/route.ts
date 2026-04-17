import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateParams } from '@/lib/validation/middleware'
import { walletAddressUsernameParam } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/wallet/addresses/[username]/primary
 *
 * Sets the named address as the caller's primary, atomically:
 *  1. clear isPrimary on every other address owned by the user,
 *  2. set isPrimary=true on the target.
 *
 * The two-step transaction (rather than a single `updateMany`) is required by
 * the partial unique index `LightningAddress_userId_primary_unique`, which
 * forbids two primary rows existing simultaneously even mid-transaction in
 * Postgres. Clearing first then promoting respects that constraint.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)

    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true },
    })
    if (!user) throw new AuthenticationError('User not found')

    const target = await prisma.lightningAddress.findUnique({ where: { username } })
    if (!target || target.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    await prisma.$transaction([
      prisma.lightningAddress.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      }),
      prisma.lightningAddress.update({
        where: { username },
        data: { isPrimary: true },
      }),
    ])

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    return NextResponse.json({ success: true, username })
  },
)
