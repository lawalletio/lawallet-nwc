import { describe, it, expect, vi, beforeEach } from 'vitest'

const { lookupInvoice, getNwcClient } = vi.hoisted(() => ({
  lookupInvoice: vi.fn(),
  getNwcClient: vi.fn()
}))

vi.mock('@/lib/client/nwc/nwc-client', () => ({
  getNwcClient
}))

import { lookupInvoice as lookupInvoiceHelper } from '@/lib/client/nwc/receive'

const NWC = 'nostr+walletconnect://abc#def'
const HASH = 'aa'.repeat(32)

beforeEach(() => {
  lookupInvoice.mockReset()
  getNwcClient.mockReset()
  getNwcClient.mockResolvedValue({ lookupInvoice })
})

describe('lookupInvoice', () => {
  it('passes the nwc string to getNwcClient and the hash to lookupInvoice', async () => {
    lookupInvoice.mockResolvedValue({
      settled_at: 1_700_000_000,
      amount: 50_000
    })
    await lookupInvoiceHelper(NWC, HASH)
    expect(getNwcClient).toHaveBeenCalledWith(NWC)
    expect(lookupInvoice).toHaveBeenCalledWith({ payment_hash: HASH })
  })

  it('reports settled when settled_at is a real timestamp', async () => {
    lookupInvoice.mockResolvedValue({
      settled_at: 1_700_000_000,
      amount: 50_000
    })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.settled).toBe(true)
    expect(status.amountSats).toBe(50)
  })

  // Regression test for the bug: a non-spec-conformant wallet that serializes
  // `settled_at: 0` for a pending invoice must NOT be reported as settled.
  // Previously `settled_at != null` evaluated `0 != null === true`.
  it('reports unsettled when settled_at is the sentinel 0 (pending invoice)', async () => {
    lookupInvoice.mockResolvedValue({ state: 'pending', settled_at: 0 })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.settled).toBe(false)
    expect(status.amountSats).toBe(0)
  })

  it('reports unsettled when settled_at is absent (spec-conformant pending)', async () => {
    lookupInvoice.mockResolvedValue({ state: 'pending', preimage: '' })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.settled).toBe(false)
  })

  it('reports unsettled when settled_at is null', async () => {
    lookupInvoice.mockResolvedValue({ settled_at: null })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.settled).toBe(false)
  })

  it('floors amount from msats to sats', async () => {
    lookupInvoice.mockResolvedValue({
      settled_at: 1_700_000_000,
      amount: 50_999
    })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.amountSats).toBe(50)
  })

  it('defaults amountSats to 0 when amount is absent', async () => {
    lookupInvoice.mockResolvedValue({ settled_at: 1_700_000_000 })
    const status = await lookupInvoiceHelper(NWC, HASH)
    expect(status.amountSats).toBe(0)
    expect(status.settled).toBe(true)
  })
})
