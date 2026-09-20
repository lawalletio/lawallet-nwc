import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WalletPaymentNoticeOverlay } from '@/components/wallet/payment-notice-overlay'
import type { WalletPaymentCue } from '@/lib/client/hooks/use-wallet-payment-notice'

const incoming: WalletPaymentCue = {
  id: 'incoming:abc',
  nwcKey: 'wallet',
  type: 'incoming',
  amountSats: 2100,
  description: 'coffee'
}

describe('WalletPaymentNoticeOverlay', () => {
  it('renders nothing without a cue', () => {
    const { container } = render(<WalletPaymentNoticeOverlay cue={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('floats the notice without taking layout space', () => {
    const { container } = render(<WalletPaymentNoticeOverlay cue={incoming} />)
    const layer = container.firstElementChild
    expect(layer).toHaveClass('absolute')
    expect(layer).toHaveClass('pointer-events-none')
    expect(screen.getByRole('status')).toHaveTextContent('Received')
    expect(screen.getByRole('status')).toHaveTextContent('+2,100')
  })
})
