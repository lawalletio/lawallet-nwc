import { prisma } from '@/lib/prisma'
import { invoiceComment } from '@/lib/invoice-comment'
import { logger } from '@/lib/logger'

/**
 * LUD-12 payer comments for the given source payment hashes, keyed by
 * lowercase hash.
 *
 * A forwarding receipt is created from a listener event, so the comment is not
 * on the receipt itself — it belongs to the invoice this instance minted for
 * that payment. Payments made to the wallet directly (not through one of our
 * Lightning Addresses) simply have no invoice, and therefore no comment.
 */
export async function commentsByPaymentHash(
  paymentHashes: string[]
): Promise<Map<string, string>> {
  const hashes = [...new Set(paymentHashes.map(hash => hash.toLowerCase()))]
  const comments = new Map<string, string>()
  if (hashes.length === 0) return comments
  // A missing comment is cosmetic; the receipt list it decorates is not. Never
  // let this lookup take the list down.
  let invoices: Array<{ paymentHash: string; metadata: unknown }> = []
  try {
    invoices = await prisma.invoice.findMany({
      where: { paymentHash: { in: hashes } },
      select: { paymentHash: true, metadata: true }
    })
  } catch (error) {
    logger.warn({ err: error }, 'forwarding receipt comments lookup failed')
    return comments
  }
  if (!Array.isArray(invoices)) return comments
  for (const invoice of invoices) {
    const comment = invoiceComment(invoice.metadata)
    if (comment) comments.set(invoice.paymentHash.toLowerCase(), comment)
  }
  return comments
}
