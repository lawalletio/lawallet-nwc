import { NextResponse } from 'next/server'
import { z } from 'zod'

import { authenticate } from '@/lib/auth/unified-auth'
import { resolveProfiles } from '@/lib/nostr/profile-cache'
import { validateBody } from '@/lib/validation/middleware'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const bodySchema = z.object({
  pubkeys: z.array(z.string().min(1)).min(1).max(200),
  force: z.boolean().optional(),
})

/**
 * POST /api/nostr/profiles
 *
 * Resolve registered users' Nostr kind-0 metadata through the server-side
 * cache. Unregistered pubkeys are silently omitted so this endpoint cannot be
 * used as a general-purpose relay proxy.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await authenticate(request)
  const body = await validateBody(request, bodySchema)
  const profiles = await resolveProfiles(body.pubkeys, {
    force: body.force ?? false,
  })
  return NextResponse.json({ profiles })
})
