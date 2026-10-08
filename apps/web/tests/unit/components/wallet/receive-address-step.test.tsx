import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ReceiveAddressStep } from '@/components/wallet/receive/address-step'

const txListener = vi.hoisted(() => ({
  current: (_tx: {
    type: 'incoming' | 'outgoing'
    amountSats: number
    paymentHash: string
  }) => {}
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: ReactNode
  }) => <a href={href}>{children}</a>
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({
    data: { lightningAddress: 'alice@localhost', effectiveNwcString: null },
    loading: false
  })
}))

vi.mock('@/components/wallet/nwc-provider', () => ({
  useWalletNwcTransactions: (
    listener: (tx: {
      type: 'incoming' | 'outgoing'
      amountSats: number
      paymentHash: string
    }) => void
  ) => {
    txListener.current = listener
  }
}))

vi.mock('@/components/wallet/shared/qr-display', () => ({
  QrDisplay: ({
    overlay,
    caption
  }: {
    overlay?: ReactNode
    caption?: string
  }) => (
    <div>
      <span>{caption}</span>
      {overlay}
    </div>
  )
}))

describe('ReceiveAddressStep', () => {
  it('floats +amount on the QR when a payment arrives', () => {
    render(<ReceiveAddressStep />)
    expect(screen.queryByRole('status')).toBeNull()

    act(() => {
      txListener.current({
        type: 'incoming',
        amountSats: 2100,
        paymentHash: 'hash-1'
      })
    })

    expect(screen.getByRole('status').textContent).toBe(
      `+${(2100).toLocaleString()}`
    )
  })

  it('ignores outgoing payments', () => {
    render(<ReceiveAddressStep />)
    act(() => {
      txListener.current({
        type: 'outgoing',
        amountSats: 500,
        paymentHash: 'hash-2'
      })
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
