import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => {
    return {
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }
  }) as unknown as typeof window.matchMedia
}

describe('useAnimatedNumber', () => {
  beforeEach(() => {
    mockMatchMedia(false)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('snaps the first non-null target without counting up from zero', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) => useAnimatedNumber(target, 600),
      { initialProps: { target: null as number | null } }
    )
    expect(result.current).toBe(0)

    rerender({ target: 12_000 })
    expect(result.current).toBe(12_000)
  })

  it('softens the duration when the user prefers reduced motion', () => {
    mockMatchMedia(true)
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) => useAnimatedNumber(target, 600),
      { initialProps: { target: 100 as number | null } }
    )
    expect(result.current).toBe(100)

    rerender({ target: 200 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(result.current).toBe(200)
  })

  it('still interpolates at the default duration', () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number | null }) => useAnimatedNumber(target, 600),
      { initialProps: { target: 100 as number | null } }
    )

    rerender({ target: 200 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(result.current).toBeGreaterThan(100)
    expect(result.current).toBeLessThan(200)
  })
})
