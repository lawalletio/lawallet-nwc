import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

import { ActivationSuccess } from '@/components/activate/activation-success'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ActivationSuccess', () => {
  it('waits for the claim-address CTA instead of auto-redirecting', async () => {
    render(
      <ActivationSuccess
        claimAddress
        nextPath="/wallet/claim-username?from=activate"
      />
    )

    expect(
      screen.getByRole('button', { name: 'Claim your address' })
    ).toBeTruthy()
    expect(screen.queryByText(/Pick a Lightning address/i)).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(pushMock).not.toHaveBeenCalled()

    vi.useRealTimers()
    await userEvent.click(
      screen.getByRole('button', { name: 'Claim your address' })
    )
    expect(pushMock).toHaveBeenCalledWith(
      '/wallet/claim-username?from=activate'
    )
  })

  it('opens the wallet only when the post-activation CTA is tapped', async () => {
    render(<ActivationSuccess />)

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(pushMock).not.toHaveBeenCalled()

    vi.useRealTimers()
    await userEvent.click(screen.getByRole('button', { name: 'Open wallet' }))
    expect(pushMock).toHaveBeenCalledWith('/wallet')
  })

  it('mentions credited sats only when a bonus was actually paid', () => {
    const { rerender } = render(<ActivationSuccess bonusSats={1000} />)
    expect(
      screen.getByText(/1,000 sats are already in your balance/)
    ).toBeTruthy()

    rerender(<ActivationSuccess />)
    expect(screen.queryByText(/sats are already in your balance/)).toBeNull()
  })
})
