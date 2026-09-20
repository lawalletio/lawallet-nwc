import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PaymentNotice } from '@/components/wallet/home/payment-notice'

describe('PaymentNotice', () => {
  it('announces a received payment', () => {
    render(
      <PaymentNotice
        cue={{
          id: 'incoming:abc',
          type: 'incoming',
          amountSats: 2100,
          description: 'coffee'
        }}
        amountLabel="2,100"
        unit="sats"
      />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Received 2,100 sats')
    expect(status).toHaveTextContent('Received')
    expect(status).toHaveTextContent('+2,100')
    expect(status).toHaveTextContent('sats')
  })

  it('announces a sent payment with a minus sign', () => {
    render(
      <PaymentNotice
        cue={{
          id: 'outgoing:def',
          type: 'outgoing',
          amountSats: 50,
          description: ''
        }}
        amountLabel="50"
        unit="sats"
      />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Sent 50 sats')
    expect(status).toHaveTextContent('Sent')
    expect(status).toHaveTextContent('−50')
  })
})
