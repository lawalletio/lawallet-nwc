import { describe, expect, it } from 'vitest'
import { mergeReceivedPayments } from '@/lib/client/received-payments'

const ENABLED_AT = '2026-08-06T00:00:00.000Z'
const enabledMs = Date.parse(ENABLED_AT)

function tx(overrides: Record<string, unknown> = {}) {
  return {
    type: 'incoming',
    paymentHash: 'aa'.repeat(32),
    amountSats: 100,
    description: 'Payment received',
    createdAt: enabledMs + 60_000,
    settledAt: enabledMs + 60_000,
    ...overrides
  } as never
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    status: 'COMPLETED',
    sourcePaymentHash: 'aa'.repeat(32),
    sourceSettledAt: new Date(enabledMs + 60_000).toISOString(),
    grossAmountMsats: 100_000,
    forwardedAmountMsats: 99_000,
    legs: [],
    lastError: null,
    ...overrides
  } as never
}

const scope = { enabled: true, enabledAt: ENABLED_AT }

describe('mergeReceivedPayments', () => {
  it('joins a payment to its receipt by payment hash', () => {
    const [row] = mergeReceivedPayments([tx()], [receipt()], scope)
    expect(row.receipt?.id).toBe('receipt-1')
    expect(row.awaitingForwarding).toBe(false)
  })

  // The wallet history is polled off the relay while receipts arrive over SSE,
  // so this window is normal — it must not read as "kept in wallet".
  it('marks a payment with no receipt yet as awaiting forwarding', () => {
    const [row] = mergeReceivedPayments([tx()], [], scope)
    expect(row.receipt).toBeNull()
    expect(row.awaitingForwarding).toBe(true)
  })

  it('leaves payments alone when forwarding is off', () => {
    const [row] = mergeReceivedPayments([tx()], [], {
      enabled: false,
      enabledAt: ENABLED_AT
    })
    expect(row.awaitingForwarding).toBe(false)
    expect(mergeReceivedPayments([tx()], [], null)[0].awaitingForwarding).toBe(
      false
    )
  })

  // Capture ignores anything that settled before forwarding was switched on, so
  // no receipt is ever coming for these.
  it('does not await a payment that predates enabledAt', () => {
    const [row] = mergeReceivedPayments(
      [tx({ settledAt: enabledMs - 1, createdAt: enabledMs - 1 })],
      [],
      scope
    )
    expect(row.awaitingForwarding).toBe(false)
  })

  it('does not await an unsettled payment', () => {
    const [row] = mergeReceivedPayments([tx({ settledAt: null })], [], scope)
    expect(row.awaitingForwarding).toBe(false)
  })

  it('ignores outgoing transactions and keeps receipts without a transaction', () => {
    const rows = mergeReceivedPayments(
      [tx({ type: 'outgoing' })],
      [receipt()],
      scope
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].transaction).toBeNull()
    expect(rows[0].receipt?.id).toBe('receipt-1')
  })

  it('sorts newest first', () => {
    const rows = mergeReceivedPayments(
      [
        tx({ paymentHash: 'bb'.repeat(32), settledAt: enabledMs + 10 }),
        tx({ paymentHash: 'cc'.repeat(32), settledAt: enabledMs + 5_000 })
      ],
      [],
      scope
    )
    expect(rows.map(row => row.timestamp)).toEqual([
      enabledMs + 5_000,
      enabledMs + 10
    ])
  })
})
