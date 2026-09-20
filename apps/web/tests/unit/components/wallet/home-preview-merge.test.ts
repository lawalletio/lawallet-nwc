import { describe, expect, it } from 'vitest'
import { mergeLivePreview } from '@/components/wallet/home-screen'
import type { NwcTransaction } from '@/lib/client/nwc'

function tx(overrides: Partial<NwcTransaction> = {}): NwcTransaction {
  return {
    type: 'incoming',
    amountSats: 1000,
    feesPaidSats: 0,
    description: 'memo from list',
    paymentHash: 'hash-1',
    preimage: 'preimage',
    settledAt: 2,
    createdAt: 2,
    ...overrides
  }
}

describe('mergeLivePreview', () => {
  it('prepends a live row the list does not yet have', () => {
    const live = tx({
      description: '',
      preimage: null,
      amountSats: 500,
      paymentHash: 'hash-new',
      createdAt: 9
    })
    const merged = mergeLivePreview([tx()], live)
    expect(merged[0]?.paymentHash).toBe('hash-new')
    expect(merged).toHaveLength(2)
  })

  it('lets the fetched list win on the same payment hash', () => {
    const live = tx({ description: '', preimage: null })
    const merged = mergeLivePreview([tx()], live)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.description).toBe('memo from list')
    expect(merged[0]?.preimage).toBe('preimage')
  })

  it('returns an empty list when both sides are empty', () => {
    expect(mergeLivePreview(null, null)).toEqual([])
  })
})
