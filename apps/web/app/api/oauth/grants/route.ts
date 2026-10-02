import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { resolveAccountId } from '@/lib/auth/account'
import { authenticateSession, listActiveGrants } from '@/lib/oauth/grants'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/oauth/grants` — the caller's connected apps: OAuth grants whose
 * code was exchanged and that are neither revoked nor expired, newest first.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await authenticateSession(request)
  const userId = await resolveAccountId(auth.pubkey)
  const grants = userId ? await listActiveGrants(userId) : []
  return NextResponse.json({ grants })
})
