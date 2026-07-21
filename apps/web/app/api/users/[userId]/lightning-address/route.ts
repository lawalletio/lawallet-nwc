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
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { requireAddressRegistration } from '@/lib/auth/paid-registration-guard'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  findInitialPrimaryWalletCandidate,
  getPrimaryRemoteWalletForUser,
  syncPrimaryRemoteWalletFlag,
} from '@/lib/wallet/primary-wallet'

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey: authenticatedPubkey, role: actorRole } = await authenticate(request)

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

    // Account-id comparison: a secondary-pubkey session still counts as "me".
    const me = await resolveAccountByPubkey(authenticatedPubkey)
    if (me?.id !== user.id) {
      throw new AuthorizationError('Not authorized to update this user')
    }

    // The user's existing primary address, if any.
    const oldLightningAddress = user.lightningAddresses[0] ?? null
    const { domain } = await getSettings(['domain'])

    // If the user already has this exact username, return it. This is not a
    // new registration and should keep working even when self-service address
    // creation is disabled.
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

    // Gate self-service address creation behind the instance policy. When user
    // registration is disabled only admins pass; when paid registration is on,
    // non-bypassing actors must go through /api/invoices + preimage claim.
    await requireAddressRegistration(actorRole)

    // Check if username is already taken by another user
    const existingAddress = await prisma.lightningAddress.findUnique({
      where: { username }
    })

    if (existingAddress && existingAddress.userId !== userId) {
      throw new ConflictError('Username is already taken by another user')
    }

    await prisma.$transaction(async tx => {
      const currentPrimaryWallet = await getPrimaryRemoteWalletForUser(userId, tx)
      const candidate =
        currentPrimaryWallet ?? (await findInitialPrimaryWalletCandidate(userId, tx))

      // Replace the primary address atomically: delete the old primary first
      // (if any) so the partial-unique-on-(userId) WHERE isPrimary=true index
      // doesn't conflict, then create the new primary.
      if (oldLightningAddress) {
        await tx.lightningAddress.delete({
          where: { username: oldLightningAddress.username }
        })
      }
      await tx.lightningAddress.create({
        data: {
          username,
          userId,
          isPrimary: true,
          mode: candidate ? 'CUSTOM_NWC' : 'IDLE',
          remoteWalletId: candidate?.id ?? null,
        }
      })
      await syncPrimaryRemoteWalletFlag(userId, tx)
    })

    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    // Bump users:updated too: the user's primary lightning-address state
    // changed, so any /api/users/me consumer (e.g. the admin "claim your
    // first address" banner) needs to refresh.
    eventBus.emit({ type: 'users:updated', timestamp: Date.now() })

    if (oldLightningAddress) {
      logActivity.fireAndForget({
        category: 'ADDRESS',
        event: ActivityEvent.ADDRESS_DELETED,
        message: `Primary address replaced: ${oldLightningAddress.username} → ${username}`,
        userId,
        metadata: {
          previousUsername: oldLightningAddress.username,
          newUsername: username,
        },
      })
    }

    logActivity.fireAndForget({
      category: 'ADDRESS',
      event: ActivityEvent.ADDRESS_CREATED,
      message: `Primary lightning address set: ${username}`,
      userId,
      metadata: { username, isPrimary: true },
    })

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
