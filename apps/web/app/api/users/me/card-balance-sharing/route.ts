import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { cardBalanceSharingSettingSchema } from '@/lib/validation/schemas'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'

/**
 * `PUT /api/users/me/card-balance-sharing` — the My cards toggle for
 * reporting this account's wallet balance in a card tap's LNURL-withdraw
 * callback, so the point of sale can show it after charging.
 */
export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)
  const userId = await requireUserId(request)
  const { enabled } = await validateBody(
    request,
    cardBalanceSharingSettingSchema
  )

  await prisma.user.update({
    where: { id: userId },
    data: { cardBalanceShared: enabled }
  })
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  return NextResponse.json({ cardBalanceShared: enabled })
})
