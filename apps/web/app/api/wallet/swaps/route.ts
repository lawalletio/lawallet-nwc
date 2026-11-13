import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody, validateQuery } from '@/lib/validation/middleware'
import { createSwapSchema, swapListQuerySchema } from '@/lib/validation/schemas'
import { createSwap, listSwapsPage, toSwapDto } from '@/lib/integrations/swaps'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function callerAccount(request: Request) {
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')
  return account
}

/**
 * GET /api/wallet/swaps?page=&pageSize= — the caller's cash-outs, newest
 * first, one page at a time.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const account = await callerAccount(request)
  const { page, pageSize } = validateQuery(request.url, swapListQuerySchema)
  return NextResponse.json(await listSwapsPage(account.id, page, pageSize))
})

/**
 * POST /api/wallet/swaps — place a Lightning → ARS order with the provider.
 * Returns the provider's BOLT11; the client pays it from the user's own
 * wallet, then polls GET /api/wallet/swaps/[id] for the bank transfer.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await rateLimit(request, RateLimitPresets.sensitive)
  await checkRequestLimits(request, 'json')
  const account = await callerAccount(request)
  const body = await validateBody(request, createSwapSchema)
  const swap = await createSwap(account.id, body)
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_SWAP_CREATED,
    message: `Cash-out of ARS ${body.amountArs} via ${body.provider}`,
    userId: account.id,
    metadata: {
      swapId: swap.id,
      provider: swap.provider,
      amountSats: swap.amountSats
    }
  })
  return NextResponse.json(toSwapDto(swap), { status: 201 })
})
