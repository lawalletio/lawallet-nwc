import type { SwapReconcileAck } from '@lawallet-nwc/shared'
import { after, NextResponse } from 'next/server'
import {
  countFollowedSwaps,
  reconcilePendingSwaps
} from '@/lib/integrations/swaps'
import { readAuthenticatedListenerBody } from '@/lib/proxy/internal-auth'
import { withErrorHandling } from '@/types/server/error-handler'

/**
 * Listener-driven cron for cash-out swaps: asks each provider for the status
 * of every swap still being followed, persists it and pushes `swaps:updated`
 * over SSE. Web has no scheduler of its own on serverless, so the listener
 * owns the timer (like zap settlement) and web decides what to check.
 *
 * `pending` tells the listener whether anything is still being followed, so
 * it ticks every minute while a transfer is in flight and backs off while
 * idle. Same HMAC as the other internal hooks; 404 when no listener is
 * configured. The body is ignored.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await readAuthenticatedListenerBody(request)
  const followed = await countFollowedSwaps()
  if (followed > 0) {
    after(async () => {
      await reconcilePendingSwaps()
    })
  }
  return NextResponse.json<SwapReconcileAck>({
    accepted: true,
    pending: followed > 0,
    nextPollAt: null
  })
})
