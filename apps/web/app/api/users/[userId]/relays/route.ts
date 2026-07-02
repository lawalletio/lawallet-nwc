import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { AuthorizationError, NotFoundError } from '@/types/server/errors'
import { updateUserRelaysSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Accept the internal id or a 64-char hex pubkey, mirroring the user GET. */
function resolveWhere(userId: string) {
  return /^[0-9a-f]{64}$/i.test(userId)
    ? { pubkey: userId.toLowerCase() }
    : { id: userId }
}

/**
 * `PUT /api/users/[userId]/relays` — set the user's preferred Nostr relays.
 *
 * Owner-only: a user manages only their OWN relay list (the caller's pubkey
 * must match the target). Not an admin action — editing someone else's Nostr
 * relays isn't meaningful. Stored as a JSON-stringified `string[]`; an empty
 * array clears the preference back to the operator default.
 */
export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticate(request)
    const { userId } = await params

    const user = await prisma.user.findUnique({
      where: resolveWhere(userId),
      select: { id: true, pubkey: true },
    })
    if (!user) throw new NotFoundError('User not found')

    // Post-lookup ownership check (so a 403 vs 404 can't probe for existence).
    if (user.pubkey !== auth.pubkey) {
      throw new AuthorizationError('You can only edit your own relays')
    }

    const { relays } = await validateBody(request, updateUserRelaysSchema)

    await prisma.user.update({
      where: { id: user.id },
      data: { relays: relays.length > 0 ? JSON.stringify(relays) : null },
    })

    eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.USER_RELAYS_UPDATED,
      message: `Nostr relays updated (${relays.length})`,
      userId: user.id,
      metadata: { count: relays.length },
    })

    return NextResponse.json({ userId: user.id, relays })
  },
)
