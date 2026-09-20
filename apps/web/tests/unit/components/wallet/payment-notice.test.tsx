import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PaymentNotice } from '@/components/wallet/home/payment-notice'

describe('PaymentNotice', () => {
  it('announces a received payment', () => {
    render(
      <PaymentNotice
        cue={{
          id: 'incoming:abc',
          nwcKey: 'wallet',
          type: 'incoming',
          amountSats: 2100,
          description: 'coffee'
        }}
        amountLabel="2,100"
        unit="sats"
      />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Received')
    expect(status).toHaveTextContent('+2,100')
    expect(status).toHaveTextContent('sats')
  })

  it('announces a sent payment with a minus sign', () => {
    render(
      <PaymentNotice
        cue={{
          id: 'outgoing:def',
          nwcKey: 'wallet',
          type: 'outgoing',
          amountSats: 50,
          description: ''
        }}
        amountLabel="50"
        unit="sats"
      />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Sent')
    expect(status).toHaveTextContent('−50')
  })

  it('masks the amount when the balance is hidden', () => {
    render(
      <PaymentNotice
        cue={{
          id: 'incoming:abc',
          nwcKey: 'wallet',
          type: 'incoming',
          amountSats: 2100,
          description: ''
        }}
        amountLabel="2,100"
        unit="sats"
        hideAmount
      />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Received')
    expect(status).toHaveTextContent('•••••')
    expect(status).not.toHaveTextContent('2,100')
  })
})
