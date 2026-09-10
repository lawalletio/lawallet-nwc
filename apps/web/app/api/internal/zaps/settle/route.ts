import { after, NextResponse } from 'next/server'
import { settlePendingZapInvoices } from '@/lib/nostr/zap-settlement'
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
 * Auth is the same HMAC as the proxy reconcile hook, and
 * {@link readAuthenticatedListenerBody} 404s when no listener is configured, so
 * the endpoint doesn't exist for anyone else. The body is ignored — web picks
 * the candidates itself, so a compromised ping can't steer it at a chosen row.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await readAuthenticatedListenerBody(request)
  after(async () => {
    await settlePendingZapInvoices()
  })
  return NextResponse.json({ accepted: true })
})
