import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listTransactions,
  lookupTransaction,
  nwcTransactionState,
  type NwcTransaction
} from '@/lib/client/nwc/transactions'

const { lookupInvoice, listTransactionsMock, getNwcClient } = vi.hoisted(
  () => ({
    lookupInvoice: vi.fn(),
    listTransactionsMock: vi.fn(),
    getNwcClient: vi.fn()
  })
)

vi.mock('@/lib/client/nwc/nwc-client', () => ({
  getNwcClient
}))

const NWC = 'nostr+walletconnect://abc#def'
const HASH = 'aa'.repeat(32)

function tx(overrides: Partial<NwcTransaction> = {}): NwcTransaction {
  return {
    type: 'incoming',
    amountSats: 21,
    feesPaidSats: 0,
    description: '',
    paymentHash: HASH,
    preimage: null,
    settledAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

beforeEach(() => {
  lookupInvoice.mockReset()
  listTransactionsMock.mockReset()
  getNwcClient.mockReset()
  getNwcClient.mockResolvedValue({
    lookupInvoice,
    listTransactions: listTransactionsMock
  })
})

describe('nwcTransactionState', () => {
  it('prefers the wallet-reported state', () => {
    expect(nwcTransactionState(tx({ state: 'failed', settledAt: 1 }))).toBe(
      'failed'
    )
  })

  it('treats a settled timestamp as settled when state is omitted', () => {
    expect(nwcTransactionState(tx({ settledAt: 1 }))).toBe('settled')
  })

  it('treats a missing timestamp as pending', () => {
    expect(nwcTransactionState(tx({ settledAt: null }))).toBe('pending')
  })
})

describe('lookupTransaction', () => {
  it('normalizes a lookup_invoice payload into an NwcTransaction', async () => {
    lookupInvoice.mockResolvedValue({
      type: 'outgoing',
      amount: 21_000_000,
      fees_paid: 3_000,
      description: 'Coffee',
      payment_hash: HASH,
      preimage: 'bb'.repeat(32),
      settled_at: 1_700_000_000,
      created_at: 1_699_999_000,
      state: 'settled'
    })

    const result = await lookupTransaction(NWC, HASH)

    expect(getNwcClient).toHaveBeenCalledWith(NWC)
    expect(lookupInvoice).toHaveBeenCalledWith({ payment_hash: HASH })
    expect(result).toEqual({
      type: 'outgoing',
      amountSats: 21_000,
      feesPaidSats: 3,
      description: 'Coffee',
      paymentHash: HASH,
      preimage: 'bb'.repeat(32),
      settledAt: 1_700_000_000_000,
      createdAt: 1_699_999_000_000,
      state: 'settled'
    })
  })

  it('returns null when the wallet has no matching invoice', async () => {
    lookupInvoice.mockRejectedValue(new Error('not found'))
    expect(await lookupTransaction(NWC, HASH)).toBeNull()
  })

  it('returns null for an empty payment hash', async () => {
    expect(await lookupTransaction(NWC, '  ')).toBeNull()
    expect(lookupInvoice).not.toHaveBeenCalled()
  })
})

describe('listTransactions', () => {
  it('drops rows without a payment hash', async () => {
    listTransactionsMock.mockResolvedValue({
      transactions: [
        {
          type: 'incoming',
          amount: 1000,
          payment_hash: HASH,
          created_at: 10
        },
        {
          type: 'incoming',
          amount: 2000,
          created_at: 11
        }
      ]
    })

    const list = await listTransactions(NWC)
    expect(list).toHaveLength(1)
    expect(list[0].paymentHash).toBe(HASH)
  })
})
