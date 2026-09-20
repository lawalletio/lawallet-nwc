import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WALLET_PAYMENT_NOTICE_MS,
  useWalletPaymentNotice
} from '@/lib/client/hooks/use-wallet-payment-notice'
import { __resetSeenNotificationsForTests } from '@/lib/client/cache/nwc-notification-dedupe'
import type { NwcTransactionEvent } from '@/lib/client/use-nwc-balance'

const NWC_KEY = 'cafef00d12345678'

function tx(overrides: Partial<NwcTransactionEvent> = {}): NwcTransactionEvent {
  return {
    type: 'incoming',
    amountSats: 1000,
    feesPaidSats: 0,
    description: 'zap',
    paymentHash: 'hash-1',
    settledAt: Date.now(),
    ...overrides
  }
}

describe('useWalletPaymentNotice', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetSeenNotificationsForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes a cue for the first notification and ignores replays', () => {
    const { result } = renderHook(() => useWalletPaymentNotice(NWC_KEY))

    act(() => {
      expect(result.current.onTransaction(tx())).toBe(true)
    })
    expect(result.current.cue?.amountSats).toBe(1000)
    expect(result.current.cue?.type).toBe('incoming')
    expect(result.current.cue?.nwcKey).toBe(NWC_KEY)

    act(() => {
      expect(result.current.onTransaction(tx())).toBe(false)
    })
    expect(result.current.cue?.id).toBe('incoming:hash-1')

    act(() => {
      result.current.onTransaction(
        tx({ type: 'outgoing', paymentHash: 'hash-2', amountSats: 21 })
      )
    })
    expect(result.current.cue?.type).toBe('outgoing')
    expect(result.current.cue?.amountSats).toBe(21)
  })

  it('dismisses the cue after the notice window', () => {
    const { result } = renderHook(() => useWalletPaymentNotice(NWC_KEY))

    act(() => {
      result.current.onTransaction(tx())
    })
    expect(result.current.cue).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(WALLET_PAYMENT_NOTICE_MS)
    })
    expect(result.current.cue).toBeNull()
  })

  it('does nothing without a wallet key', () => {
    const { result } = renderHook(() => useWalletPaymentNotice(null))
    act(() => {
      expect(result.current.onTransaction(tx())).toBe(false)
    })
    expect(result.current.cue).toBeNull()
  })

  it('hides a cue that belongs to a previous wallet', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useWalletPaymentNotice(key),
      { initialProps: { key: NWC_KEY as string | null } }
    )
    act(() => {
      expect(result.current.onTransaction(tx())).toBe(true)
    })
    expect(result.current.cue).not.toBeNull()

    rerender({ key: 'bbbbbbbbbbbbbbbb' })
    expect(result.current.cue).toBeNull()
  })
})
