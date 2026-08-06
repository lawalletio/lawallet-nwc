import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { readAuthenticatedListenerBody } from '@/lib/proxy/internal-auth'
import { reconcileProxyPayments } from '@/lib/proxy/reconcile'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import { reconcileInvoiceZapReceipts } from '@/lib/nostr/zap-receipts'
import { reconcileRemoteWalletNotifications } from '@/lib/remote-wallet-notifications/reconcile'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'

const bodySchema = z.object({
  settlementIds: z.array(z.string().min(1)).max(10).optional(),
  forwardingReceiptIds: z.array(z.string().min(1)).max(10).optional()
})

export const POST = withErrorHandling(async (request: Request) => {
  const raw = await readAuthenticatedListenerBody(request)
  let json: unknown
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    throw new ValidationError('Invalid JSON body')
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    throw new ValidationError('Invalid request data', parsed.error.errors)
  }
  after(async () => {
    await Promise.all([
      reconcileProxyPayments({ ids: parsed.data.settlementIds }),
      reconcileRemoteWalletForwarding({
        ids: parsed.data.forwardingReceiptIds
      }),
      reconcileInvoiceZapReceipts(),
      reconcileRemoteWalletNotifications()
    ])
  })
  return NextResponse.json({ accepted: true })
})
