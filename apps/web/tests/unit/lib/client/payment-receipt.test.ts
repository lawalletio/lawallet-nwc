import { describe, expect, it } from 'vitest'
import {
  buildPaymentReceiptText,
  maskProofValue,
  paymentHashFromBolt11
} from '@/lib/client/payment-receipt'

describe('buildPaymentReceiptText', () => {
  it('includes amount, fee, destination, and proof fields', () => {
    const text = buildPaymentReceiptText({
      amountLabel: '21,000 sats',
      feeLabel: '3 sats',
      recipient: 'Satoshi',
      destination: 'satoshi@example.com',
      comment: 'Coffee',
      settledAt: 1_726_747_200_000,
      paymentHash: 'hashhash',
      preimage: 'preimagepreimage'
    })

    expect(text).toContain('LaWallet payment receipt')
    expect(text).toContain('Status: Settled')
    expect(text).toContain('Amount: 21,000 sats')
    expect(text).toContain('Fee: 3 sats')
    expect(text).toContain('To: Satoshi')
    expect(text).toContain('Destination: satoshi@example.com')
    expect(text).toContain('Note: Coffee')
    expect(text).toContain('Payment hash:')
    expect(text).toContain('hashhash')
    expect(text).toContain('Preimage:')
    expect(text).toContain('preimagepreimage')
  })

  it('omits missing optional fields and duplicate destinations', () => {
    const text = buildPaymentReceiptText({
      amountLabel: '1,000 sats',
      feeLabel: '0 sats',
      recipient: 'alice@example.com',
      destination: 'alice@example.com',
      comment: null,
      settledAt: null,
      paymentHash: null,
      preimage: ''
    })

    expect(text).toContain('To: alice@example.com')
    expect(text).not.toContain('Destination:')
    expect(text).not.toContain('Note:')
    expect(text).not.toContain('Time:')
    expect(text).not.toContain('Payment hash:')
    expect(text).not.toContain('Preimage:')
  })

  it('omits fee and counterpart when they are not provided', () => {
    const text = buildPaymentReceiptText({
      amountLabel: '21,000 sats',
      comment: 'Coffee',
      paymentHash: 'hashhash'
    })

    expect(text).toContain('Amount: 21,000 sats')
    expect(text).toContain('Note: Coffee')
    expect(text).not.toContain('Fee:')
    expect(text).not.toContain('To:')
    expect(text).toContain('hashhash')
  })
})

describe('maskProofValue', () => {
  it('keeps a short prefix and suffix on long hex values', () => {
    const hex = 'e3b0c44298fc1c149afbf4c8996fb924'
    expect(maskProofValue(hex)).toBe('e3b0c4••••b924')
  })

  it('fully masks short values', () => {
    expect(maskProofValue('abc123')).toBe('••••••')
    expect(maskProofValue('')).toBe('')
  })
})

describe('paymentHashFromBolt11', () => {
  it('returns null for an unparseable invoice', () => {
    expect(paymentHashFromBolt11('lnbcbogus')).toBeNull()
    expect(paymentHashFromBolt11('not-an-invoice')).toBeNull()
  })
})
