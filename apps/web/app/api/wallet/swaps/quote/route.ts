import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateQuery } from '@/lib/validation/middleware'
import { swapQuoteQuerySchema } from '@/lib/validation/schemas'
import { quoteSwaps } from '@/lib/integrations/swaps'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/swaps/quote?amountArs= — sats each available provider
 * would charge to wire `amountArs` pesos. `[]` when none is enabled.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticate(request)
  await rateLimit(request, RateLimitPresets.auth)
  const { amountArs } = validateQuery(request.url, swapQuoteQuerySchema)
  return NextResponse.json(await quoteSwaps(amountArs))
})
