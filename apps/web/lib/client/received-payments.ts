import type { NwcTransaction } from '@/lib/client/nwc'
import type { ForwardReceiptData } from '@/lib/client/hooks/use-remote-wallet-forwarding'

export type ReceivedPaymentRow = {
  key: string
  timestamp: number
  transaction: NwcTransaction | null
  receipt: ForwardReceiptData | null
  /**
   * Landed while forwarding was on, but no receipt yet. The wallet history is
   * polled straight off the relay while receipts arrive over SSE, so a payment
   * is visible before it has been captured — and "kept in wallet" would be a
   * settled-sounding claim about money that is about to move.
   */
  awaitingForwarding: boolean
}

/** Enough of the receive action to tell whether a payment is in forwarding scope. */
export type ForwardingScope = {
  enabled: boolean
  enabledAt: string | null
} | null

export function mergeReceivedPayments(
  transactions: NwcTransaction[],
  receipts: ForwardReceiptData[],
  forwarding: ForwardingScope = null
): ReceivedPaymentRow[] {
  const incoming = transactions.filter(
    transaction => transaction.type === 'incoming'
  )
  const receiptByHash = new Map(
    receipts.map(receipt => [receipt.sourcePaymentHash.toLowerCase(), receipt])
  )
  // Capture ignores anything that settled before forwarding was switched on, so
  // the same cutoff decides whether a receipt is still owed here.
  const enabledAt =
    forwarding?.enabled && forwarding.enabledAt
      ? Date.parse(forwarding.enabledAt)
      : null
  const matchedReceiptIds = new Set<string>()
  const rows: ReceivedPaymentRow[] = incoming.map((transaction, index) => {
    const receipt = transaction.paymentHash
      ? (receiptByHash.get(transaction.paymentHash.toLowerCase()) ?? null)
      : null
    if (receipt) matchedReceiptIds.add(receipt.id)
    const timestamp = transaction.settledAt ?? transaction.createdAt
    return {
      key: transaction.paymentHash
        ? `payment:${transaction.paymentHash.toLowerCase()}`
        : `payment:${transaction.settledAt ?? transaction.createdAt}:${index}`,
      timestamp,
      transaction,
      receipt,
      awaitingForwarding:
        !receipt &&
        transaction.settledAt != null &&
        enabledAt != null &&
        !Number.isNaN(enabledAt) &&
        timestamp >= enabledAt
    }
  })

  for (const receipt of receipts) {
    if (matchedReceiptIds.has(receipt.id)) continue
    rows.push({
      key: `receipt:${receipt.id}`,
      timestamp: Date.parse(receipt.sourceSettledAt),
      transaction: null,
      receipt,
      awaitingForwarding: false
    })
  }

  return rows.sort((a, b) => b.timestamp - a.timestamp)
}
