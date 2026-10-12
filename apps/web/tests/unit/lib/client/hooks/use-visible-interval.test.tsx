import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVisibleInterval } from '@/lib/client/hooks/use-visible-interval'

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

function Poller({ cb, enabled = true }: { cb: () => void; enabled?: boolean }) {
  useVisibleInterval(cb, 1_000, enabled)
  return null
}

afterEach(() => {
  vi.useRealTimers()
  setHidden(false)
})

describe('useVisibleInterval', () => {
  it('ticks while visible, skips while hidden, catches up on return', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    render(<Poller cb={cb} />)

    act(() => vi.advanceTimersByTime(2_000))
    expect(cb).toHaveBeenCalledTimes(2)

    act(() => setHidden(true))
    act(() => vi.advanceTimersByTime(5_000))
    expect(cb).toHaveBeenCalledTimes(2)

    act(() => setHidden(false))
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('does nothing when disabled', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    render(<Poller cb={cb} enabled={false} />)
    act(() => vi.advanceTimersByTime(5_000))
    expect(cb).not.toHaveBeenCalled()
  })
})
