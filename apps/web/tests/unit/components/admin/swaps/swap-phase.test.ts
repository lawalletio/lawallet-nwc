import { describe, it, expect } from 'vitest'
import { swapPhase, type Swap } from '@/components/admin/swaps/swap-shared'

const now = Date.parse('2026-11-13T12:00:00Z')
const swap = (over: Partial<Swap>): Swap =>
  ({
    status: 'PENDING',
    paidAt: null,
    expiresAt: '2026-11-13T12:10:00Z',
    ...over
  }) as Swap

describe('swapPhase', () => {
  it('trusts the provider for terminal states', () => {
    expect(swapPhase(swap({ status: 'COMPLETED' }), now)).toBe('completed')
    expect(swapPhase(swap({ status: 'FAILED', paidAt: 'x' }), now)).toBe(
      'failed'
    )
  })

  it('splits PENDING by payment proof and expiry', () => {
    expect(swapPhase(swap({}), now)).toBe('awaiting')
    expect(swapPhase(swap({ paidAt: '2026-11-13T11:59:00Z' }), now)).toBe(
      'transferring'
    )
    expect(swapPhase(swap({ expiresAt: '2026-11-13T11:00:00Z' }), now)).toBe(
      'expired'
    )
    // Paid before expiry stays in transfer even after the invoice expires.
    expect(
      swapPhase(swap({ paidAt: 'x', expiresAt: '2026-11-13T11:00:00Z' }), now)
    ).toBe('transferring')
  })
})
