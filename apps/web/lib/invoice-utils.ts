import { decode } from 'light-bolt11-decoder'
import {
  CARD_MAX_WITHDRAWABLE_MSATS,
  CARD_MIN_WITHDRAWABLE_MSATS
} from '@/lib/validation/schemas'

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
 * Extracts the amount from a bolt11 invoice, in satoshis. Returns `null` for a
 * zero-amount invoice or anything that can't be decoded.
 */
export function extractAmountSats(bolt11: string): number | null {
  try {
    const decoded = decode(bolt11)
    const section = decoded.sections.find(s => s.name === 'amount')
    if (!section || !('value' in section)) return null
    const msats = Number(section.value)
    if (!Number.isFinite(msats) || msats <= 0) return null
    return Math.floor(msats / 1000)
  } catch {
    return null
  }
}

export interface CardPaymentInvoice {
  bolt11: string
  paymentHash: string
  amountMsats: number
  amountSats: number
  expiresAt: number
}

/** Carries the already-decoded invoice so an exact retry can reconcile it. */
export class ExpiredCardPaymentInvoiceError extends Error {
  constructor(public readonly invoice: CardPaymentInvoice) {
    super('Lightning invoice has expired')
    this.name = 'ExpiredCardPaymentInvoiceError'
  }
}

/**
 * Strict, single-pass validation for the irrevocable BoltCard payment path.
 * The advertised LUD-03 bounds are enforced here before the SUN counter is
 * consumed, so malformed/expired/oversized invoices fail without burning a tap.
 */
export function parseCardPaymentInvoice(
  bolt11: string,
  nowMs = Date.now()
): CardPaymentInvoice {
  let decoded: ReturnType<typeof decode>
  try {
    decoded = decode(bolt11)
  } catch {
    throw new Error('Invalid Lightning invoice')
  }

  const amountSection = decoded.sections.find(
    section => section.name === 'amount'
  )
  const hashSection = decoded.sections.find(
    section => section.name === 'payment_hash'
  )
  const timestampSection = decoded.sections.find(
    section => section.name === 'timestamp'
  )

  const amountMsats =
    amountSection && 'value' in amountSection
      ? Number(amountSection.value)
      : Number.NaN
  if (
    !Number.isSafeInteger(amountMsats) ||
    amountMsats < CARD_MIN_WITHDRAWABLE_MSATS ||
    amountMsats > CARD_MAX_WITHDRAWABLE_MSATS
  ) {
    throw new Error(
      `Invoice amount must be between ${CARD_MIN_WITHDRAWABLE_MSATS} and ${CARD_MAX_WITHDRAWABLE_MSATS} msats`
    )
  }

  const paymentHash =
    hashSection &&
    'value' in hashSection &&
    typeof hashSection.value === 'string'
      ? hashSection.value.toLowerCase()
      : ''
  if (!/^[0-9a-f]{64}$/.test(paymentHash)) {
    throw new Error('Invoice payment hash is missing or invalid')
  }

  const timestamp =
    timestampSection && 'value' in timestampSection
      ? Number(timestampSection.value)
      : Number.NaN
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invoice timestamp is missing or invalid')
  }
  // light-bolt11-decoder exposes `expiry` as the tag's *duration* in seconds,
  // not as an absolute timestamp, so it must be added to the invoice
  // timestamp. When the optional tag is absent BOLT-11's default lifetime is
  // one hour.
  const expirySeconds =
    typeof decoded.expiry === 'number' && Number.isFinite(decoded.expiry)
      ? decoded.expiry
      : 3600
  const expiresAtSeconds = timestamp + expirySeconds
  const expiresAt = expiresAtSeconds * 1000
  const invoice = {
    bolt11,
    paymentHash,
    amountMsats,
    amountSats: Math.floor(amountMsats / 1000),
    expiresAt
  }
  if (expiresAt <= nowMs) throw new ExpiredCardPaymentInvoiceError(invoice)
  return invoice
}

/**
 * Extracts the human-readable description/memo from a bolt11 invoice.
 * Returns `null` when absent or undecodable.
 */
export function extractDescription(bolt11: string): string | null {
  try {
    const decoded = decode(bolt11)
    const section = decoded.sections.find(s => s.name === 'description')
    if (!section || !('value' in section)) return null
    const value = section.value
    return typeof value === 'string' && value.length > 0 ? value : null
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
