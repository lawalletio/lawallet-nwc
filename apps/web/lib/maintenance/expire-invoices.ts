import { eventBus } from '@/lib/events/event-bus'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

/**
 * How long past `expiresAt` an invoice stays PENDING. Comfortably longer than
 * the zap sweep's own post-expiry poll window, so a payment that lands at the
 * last second still settles through the normal paths first. A listener webhook
 * that arrives even later still flips EXPIRED → PAID (it only skips PAID rows).
 */
export const STALE_INVOICE_GRACE_MS = 60 * 60 * 1000

const BATCH_SIZE = 500
/** Bounds one tick's work; a large backlog drains over a few ticks. */
const MAX_BATCHES = 20

/**
 * Move ordinary invoices that expired unpaid from PENDING to EXPIRED.
 *
 * Only the proxy reconciler and the claim route used to do this, so every
 * other PENDING row stayed PENDING forever and each sweep over that status
 * scanned a set that only grew. Proxy invoices are left to the proxy state
 * machine, which owns their lifecycle.
 *
 * @returns how many invoices were expired.
 */
export async function expireStaleInvoices(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_INVOICE_GRACE_MS)
  let expired = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { count } = await prisma.invoice.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: cutoff },
        proxyPayment: null
      },
      data: { status: 'EXPIRED' },
      limit: BATCH_SIZE
    })
    expired += count
    if (count < BATCH_SIZE) break
  }
  if (expired > 0) {
    logger.info({ expired }, 'maintenance.invoices_expired')
    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
  }
  return expired
}
