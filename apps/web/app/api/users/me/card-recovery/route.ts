import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { cardRecoverySettingSchema } from '@/lib/validation/schemas'
import { setCardRecoveryEnabled } from '@/lib/account/recover'

export const dynamic = 'force-dynamic'

/**
 * `PUT /api/users/me/card-recovery` — the Security-screen opt-out for
 * card-based account recovery. Turning it off also revokes any outstanding
 * RECOVER QR for the caller's cards.
 */
export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)
  const userId = await requireUserId(request)
  const { enabled } = await validateBody(request, cardRecoverySettingSchema)

  const result = await setCardRecoveryEnabled(userId, enabled)
  return NextResponse.json({ cardRecoveryEnabled: result.enabled })
})
