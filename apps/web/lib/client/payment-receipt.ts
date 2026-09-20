import { formatDateTime } from '@/lib/client/format'
import { parseDestination } from '@/lib/client/nwc/parse-destination'

export type PaymentReceiptStatus = 'settled' | 'pending' | 'failed'

export interface PaymentReceiptInput {
  amountLabel: string
  feeLabel?: string | null
  recipient?: string
  destination?: string | null
  comment?: string | null
  settledAt?: number | null
  paymentHash?: string | null
  preimage?: string | null
  status?: PaymentReceiptStatus
}

/**
 * Plain-text Lightning receipt for share/copy. Includes proof fields the
 * user already has on-screen — they explicitly chose to export.
 */
function receiptStatusLabel(status?: PaymentReceiptStatus): string {
  if (status === 'pending') return 'Pending'
  if (status === 'failed') return 'Failed'
  return 'Settled'
}

export function buildPaymentReceiptText(input: PaymentReceiptInput): string {
  const lines = [
    'LaWallet payment receipt',
    '',
    `Status: ${receiptStatusLabel(input.status)}`,
    `Amount: ${input.amountLabel}`
  ]

  if (input.feeLabel?.trim()) {
    lines.push(`Fee: ${input.feeLabel.trim()}`)
  }

  const recipient = input.recipient?.trim() || ''
  if (recipient) {
    lines.push(`To: ${recipient}`)
  }

  const destination = input.destination?.trim() || null
  if (destination && destination !== recipient) {
    lines.push(`Destination: ${destination}`)
  }

  if (input.comment?.trim()) {
    lines.push(`Note: ${input.comment.trim()}`)
  }

  if (input.settledAt) {
    lines.push(`Time: ${formatDateTime(input.settledAt)}`)
  }

  if (input.paymentHash?.trim()) {
    lines.push('', 'Payment hash:', input.paymentHash.trim())
  }

  if (input.preimage?.trim()) {
    lines.push('', 'Preimage:', input.preimage.trim())
  }

  return lines.join('\n')
}

/** Masks a hex proof so it can sit on-screen without leaking the full value. */
export function maskProofValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 12) return '•'.repeat(trimmed.length)
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`
}

/** Best-effort payment hash from a bolt11 quote. Returns null if unparseable. */
export function paymentHashFromBolt11(bolt11: string): string | null {
  try {
    const dest = parseDestination(bolt11)
    return dest.kind === 'invoice' ? dest.paymentHash : null
  } catch {
    return null
  }
}
