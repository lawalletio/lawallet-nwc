import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile } from '@/components/ui/use-mobile'

const ORIGINAL_INNER_WIDTH = window.innerWidth

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 848
  })

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: ORIGINAL_INNER_WIDTH
  })
})

describe('useIsMobile', () => {
  it('supports a wider breakpoint for responsive sidebars', async () => {
    const { result } = renderHook(() => useIsMobile(1024))

    await waitFor(() => expect(result.current).toBe(true))
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 1023px)')
  })

  it('keeps the default mobile breakpoint unchanged', async () => {
    const { result } = renderHook(() => useIsMobile())

    await waitFor(() => expect(result.current).toBe(false))
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)')
  })
})
