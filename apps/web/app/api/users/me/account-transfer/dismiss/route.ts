import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { dismissAccountTransferNotices } from '@/lib/account/recover'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/users/me/account-transfer/dismiss` — the old owner acknowledges
 * the "your account was transferred" notice shown after a card recovery
 * moved their account away. Idempotent.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await rateLimit(request, RateLimitPresets.auth)
  const userId = await requireUserId(request)
  const dismissed = await dismissAccountTransferNotices(userId)
  return NextResponse.json({ dismissed })
})
