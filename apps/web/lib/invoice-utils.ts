import { decode } from 'light-bolt11-decoder'

/**
 * Metadata shape stored on the `Invoice.metadata` JSON column.
 * Different purposes carry different fields; keep them optional.
 */
export interface InvoiceMetadata {
  /** Recipient username for LUD-16 and registration invoices. */
  username?: string
  /** LUD-12 comment sent by the payer, if any. */
  comment?: string
  [key: string]: unknown
}

/**
 * Extracts the payment hash (hex) from a bolt11 invoice string.
 * Returns `null` if the invoice cannot be decoded or the field is missing.
 */
export function extractPaymentHash(bolt11: string): string | null {
  try {
    const decoded = decode(bolt11)
    const section = decoded.sections.find(s => s.name === 'payment_hash')
    if (!section || !('value' in section)) return null
    return section.value as string
  } catch {
    return null
  }
}

/**
 * Extracts the expiry timestamp from a bolt11 invoice as a `Date`.
 * Falls back to 10 minutes from now if expiry can't be parsed.
 */
export function extractExpiry(bolt11: string): Date {
  try {
    const decoded = decode(bolt11)
    const timestampSection = decoded.sections.find(s => s.name === 'timestamp')
    const expirySection = decoded.sections.find(s => s.name === 'expiry')
    const timestamp =
      timestampSection && 'value' in timestampSection
        ? Number(timestampSection.value)
        : Math.floor(Date.now() / 1000)
    const expiry =
      expirySection && 'value' in expirySection
        ? Number(expirySection.value)
        : 600
    return new Date((timestamp + expiry) * 1000)
  } catch {
    return new Date(Date.now() + 10 * 60 * 1000)
  }
}

/**
 * Status enum values stored in `Invoice.status`.
 */
export type InvoiceStatusValue = 'PENDING' | 'PAID' | 'EXPIRED'

/**
 * Returns true if an invoice can still be settled (PENDING and not past expiry).
 */
export function isInvoiceActive(invoice: {
  status: InvoiceStatusValue
  expiresAt: Date
}): boolean {
  return invoice.status === 'PENDING' && invoice.expiresAt >= new Date()
}
