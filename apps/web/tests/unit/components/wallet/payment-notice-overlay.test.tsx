import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPaymentNoticeOverlay } from '@/components/wallet/payment-notice-overlay'
import type { WalletPaymentCue } from '@/lib/client/hooks/use-wallet-payment-notice'

const playCueMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/client/payment-sound', () => ({
  playPaymentCueSound: playCueMock
}))

const incoming: WalletPaymentCue = {
  id: 'incoming:abc',
  nwcKey: 'wallet',
  type: 'incoming',
  amountSats: 2100,
  description: 'coffee'
}

describe('WalletPaymentNoticeOverlay', () => {
  beforeEach(() => {
    playCueMock.mockClear()
  })

  it('renders nothing without a cue', () => {
    const { container } = render(<WalletPaymentNoticeOverlay cue={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(playCueMock).not.toHaveBeenCalled()
  })

  it('floats the notice without taking layout space', () => {
    const { container } = render(<WalletPaymentNoticeOverlay cue={incoming} />)
    const layer = container.firstElementChild
    expect(layer).toHaveClass('absolute')
    expect(layer).toHaveClass('pointer-events-none')
    expect(screen.getByRole('status')).toHaveTextContent('Received')
    expect(screen.getByRole('status')).toHaveTextContent('+2,100')
    expect(playCueMock).toHaveBeenCalledWith('incoming:abc')
  })
})
