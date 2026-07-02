import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

let mockPath = '/wallet'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath
}))

import {
  FirstLoadProgressProvider,
  useFirstLoadProgress,
  type ProgressStep
} from '@/components/pwa/first-load-progress'

function Reporter({ steps }: { steps: ProgressStep[] }) {
  const { report } = useFirstLoadProgress()
  return (
    <button data-testid="report" onClick={() => steps.forEach(report)}>
      report
    </button>
  )
}

// The bar is the fixed top element; its child div carries the width style.
function barWidth(): number {
  const inner = document.querySelector('[aria-hidden] > div') as HTMLElement | null
  const w = inner?.style.width ?? '0%'
  return parseInt(w, 10) || 0
}

describe('FirstLoadProgressProvider', () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockPath = '/wallet'
  })

  it('starts at a visible baseline before any milestone', () => {
    render(
      <FirstLoadProgressProvider>
        <Reporter steps={[]} />
      </FirstLoadProgressProvider>
    )
    expect(barWidth()).toBeGreaterThan(0)
    expect(barWidth()).toBeLessThan(100)
  })

  it('reaches 100% once all home milestones report and remembers completion', () => {
    render(
      <FirstLoadProgressProvider>
        <Reporter steps={['auth', 'profile', 'balance']} />
      </FirstLoadProgressProvider>
    )
    act(() => {
      screen.getByTestId('report').click()
    })
    expect(barWidth()).toBe(100)
    expect(sessionStorage.getItem('lawallet:first-load-done')).toBe('1')
  })

  it('completes on auth alone for non-home entry routes', () => {
    mockPath = '/wallet/settings'
    render(
      <FirstLoadProgressProvider>
        <Reporter steps={['auth']} />
      </FirstLoadProgressProvider>
    )
    act(() => {
      screen.getByTestId('report').click()
    })
    expect(barWidth()).toBe(100)
  })

  it('does not re-arm the bar after the first load completed this session', () => {
    sessionStorage.setItem('lawallet:first-load-done', '1')
    render(
      <FirstLoadProgressProvider>
        <Reporter steps={['auth', 'profile', 'balance']} />
      </FirstLoadProgressProvider>
    )
    // Already loaded → bar width stays 0 (not armed).
    expect(barWidth()).toBe(0)
  })
})
