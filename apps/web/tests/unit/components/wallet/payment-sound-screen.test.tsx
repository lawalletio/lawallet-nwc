import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PaymentSoundScreen } from '@/components/wallet/settings/payment-sound-screen'

const playMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn() }),
  usePathname: () => '/wallet/settings/payment-sound'
}))

vi.mock('@/lib/client/payment-sound', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/payment-sound')>()
  return {
    ...actual,
    playPaymentSuccessSound: playMock
  }
})

describe('PaymentSoundScreen', () => {
  beforeEach(() => {
    window.localStorage.clear()
    playMock.mockClear()
  })

  it('selects Sapeee and previews it', () => {
    render(<PaymentSoundScreen />)
    fireEvent.click(screen.getByRole('radio', { name: /Sapeee/ }))
    expect(screen.getByRole('radio', { name: /Sapeee/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(window.localStorage.getItem('lawallet-payment-sound:v1')).toBe(
      'bananero'
    )
    expect(playMock).toHaveBeenCalledWith('bananero')
  })
})
