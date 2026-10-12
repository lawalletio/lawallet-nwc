import { describe, it, expect } from 'vitest'
import { shouldLookupInvoice } from '@/lib/invoices/lookup-throttle'

// Module state persists across tests, so each test uses its own hashes.
describe('shouldLookupInvoice', () => {
  it('allows the first lookup and suppresses repeats inside 5s', () => {
    expect(shouldLookupInvoice('h1', 10_000)).toBe(true)
    expect(shouldLookupInvoice('h1', 11_000)).toBe(false)
    expect(shouldLookupInvoice('h1', 14_999)).toBe(false)
    expect(shouldLookupInvoice('h1', 15_000)).toBe(true)
    // The window restarts from the lookup that was allowed.
    expect(shouldLookupInvoice('h1', 16_000)).toBe(false)
  })

  it('throttles each invoice independently', () => {
    expect(shouldLookupInvoice('h2', 0)).toBe(true)
    expect(shouldLookupInvoice('h3', 0)).toBe(true)
    expect(shouldLookupInvoice('h2', 1)).toBe(false)
  })

  it('stays bounded by forgetting the oldest invoice', () => {
    expect(shouldLookupInvoice('oldest', 0)).toBe(true)
    for (let i = 0; i < 1_000; i++) shouldLookupInvoice(`bulk-${i}`, 0)
    // Evicted, so it is asked again even though its window has not passed.
    expect(shouldLookupInvoice('oldest', 1)).toBe(true)
  })
})
