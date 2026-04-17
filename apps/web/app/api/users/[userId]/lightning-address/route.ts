import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '@/types/server/errors'
import { userIdParam, updateLightningAddressSchema } from '@/lib/validation/schemas'
import { validateParams, validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticate } from '@/lib/auth/unified-auth'
import { eventBus } from '@/lib/events/event-bus'

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey: authenticatedPubkey } = await authenticate(request)

    const { userId } = validateParams(await params, userIdParam)
    const { username } = await validateBody(request, updateLightningAddressSchema)

    // Check if user exists. Pull the user's primary address (at most one) —
    // this endpoint preserves the legacy "one primary lightning address per
    // user" semantics; multi-address management lives under /api/wallet/*.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { lightningAddresses: { where: { isPrimary: true }, take: 1 } }
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    if (user.pubkey !== authenticatedPubkey) {
      throw new AuthorizationError('Not authorized to update this user')
    }

    // The user's existing primary address, if any.
    const oldLightningAddress = user.lightningAddresses[0] ?? null

    // Check if username is already taken by another user
    const existingAddress = await prisma.lightningAddress.findUnique({
      where: { username }
    })

    if (existingAddress && existingAddress.userId !== userId) {
      throw new ConflictError('Username is already taken by another user')
    }

    const { domain } = await getSettings(['domain'])

    // If the user already has this exact username, return it
    if (oldLightningAddress && oldLightningAddress.username === username) {
      const completeAddress = `${username}@${domain}`
      return NextResponse.json({
        lightningAddress: completeAddress,
        username,
        domain,
        userId,
        replaced: null
      })
    }

    // Replace the primary address atomically: delete the old primary first
    // (if any) so the partial-unique-on-(userId) WHERE isPrimary=true index
    // doesn't conflict, then create the new primary.
    if (oldLightningAddress) {
      await prisma.lightningAddress.delete({
        where: { username: oldLightningAddress.username }
      })
    }
    await prisma.lightningAddress.create({
      data: {
        username,
        userId,
        isPrimary: true,
      }
    })

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })

    // Return the complete lightning address string
    const completeAddress = `${username}@${domain}`

    return NextResponse.json({
      lightningAddress: completeAddress,
      username,
      domain,
      userId,
      replaced: oldLightningAddress
        ? `${oldLightningAddress.username}@${domain}`
        : null
    })
  }
)
