import type { ZapSettleAck } from '@lawallet-nwc/shared'
import { after, NextResponse } from 'next/server'
import {
  getZapSettlementBacklog,
  sweepDueZapInvoices
} from '@/lib/nostr/zap-settlement'
import { readAuthenticatedListenerBody } from '@/lib/proxy/internal-auth'
import { withErrorHandling } from '@/types/server/error-handler'

/**
 * Listener-only tick that polls pending zap invoices to settlement.
 *
 * The listener owns the timer rather than web because web has no scheduler it
 * can rely on across every supported deployment (serverless included). This
 * keeps the listener transport-only: it says "now would be a good time", and
 * web decides what that means.
 *
 * The response tells the listener whether any zap invoice is still open
 * (`pending`) and when the next one is due (`nextPollAt`), so it can back off
 * while there is nothing to settle. The sweep itself only runs when something
 * is due now. A listener that ignores these fields keeps its fixed cadence.
 *
 * Auth is the same HMAC as the proxy reconcile hook, and
 * {@link readAuthenticatedListenerBody} 404s when no listener is configured, so
 * the endpoint doesn't exist for anyone else. The body is ignored — web picks
 * the candidates itself, so a compromised ping can't steer it at a chosen row.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await readAuthenticatedListenerBody(request)
  const now = new Date()
  const backlog = await getZapSettlementBacklog(now)
  if (backlog.nextPollAt && backlog.nextPollAt <= now) {
    after(async () => {
      await sweepDueZapInvoices(now)
    })
  }
  return NextResponse.json<ZapSettleAck>({
    accepted: true,
    pending: backlog.pending,
    nextPollAt: backlog.nextPollAt?.toISOString() ?? null
  })
})
