import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey, resolveAccountId } from '@/lib/auth/account'
import { AuthorizationError, NotFoundError } from '@/types/server/errors'
import { updateUserRelaysSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Accept the internal id or a 64-char hex pubkey, mirroring the user GET.
 * A hex pubkey resolves through the account seam (NostrIdentity first) so
 * secondary identities land on the same account; null when unknown.
 */
async function resolveTargetUserId(userId: string): Promise<string | null> {
  if (/^[0-9a-f]{64}$/i.test(userId)) {
    return resolveAccountId(userId.toLowerCase())
  }
  return userId
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

    const targetId = await resolveTargetUserId(userId)
    const user = targetId
      ? await prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, pubkey: true },
        })
      : null
    if (!user) throw new NotFoundError('User not found')

    // Post-lookup ownership check (so a 403 vs 404 can't probe for existence).
    // Account-id comparison: a secondary-pubkey session still counts as "me".
    const me = await resolveAccountByPubkey(auth.pubkey)
    if (!me || me.id !== user.id) {
      throw new AuthorizationError('You can only edit your own relays')
    }

    const { relays } = await validateBody(request, updateUserRelaysSchema)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        relays: relays.length > 0 ? JSON.stringify(relays) : null,
        // Stamp so nostr.json serves this manual choice fresh (no NIP-65
        // re-query) until the cache TTL elapses.
        relaysUpdatedAt: new Date(),
      },
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
