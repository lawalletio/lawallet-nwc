import { after, NextResponse } from 'next/server'
import { z } from 'zod'

import { Permission } from '@/lib/auth/permissions'
import { authenticate, authHasPermission } from '@/lib/auth/unified-auth'
import { resolveProfiles } from '@/lib/nostr/profile-cache'
import { validateBody } from '@/lib/validation/middleware'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const bodySchema = z.object({
  pubkeys: z.array(z.string().min(1)).min(1).max(200),
  force: z.boolean().optional()
})

/**
 * POST /api/nostr/profiles
 *
 * Resolve registered users' Nostr kind-0 metadata through the server-side
 * cache. Unregistered pubkeys are silently omitted so this endpoint cannot be
 * used as a general-purpose relay proxy.
 *
 * Stale profiles are served from the cache and refreshed after the response.
 * `force` (bypass the cache and block on relays) is only honoured for callers
 * who can read users (the admin user page); for anyone else it is ignored, so
 * a wallet user can't make the server fan out 200 relay queries per request.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await authenticate(request)
  const body = await validateBody(request, bodySchema)
  const force =
    (body.force ?? false) && authHasPermission(auth, Permission.USERS_READ)
  const profiles = await resolveProfiles(body.pubkeys, {
    force,
    schedule: after
  })
  return NextResponse.json({ profiles })
})
