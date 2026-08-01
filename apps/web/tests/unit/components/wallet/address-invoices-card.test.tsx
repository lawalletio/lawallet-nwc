import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAddressInvoices: vi.fn(),
  useProxyForwardingMutations: vi.fn(),
  retryForwarding: vi.fn(),
  changeDestination: vi.fn(),
  refetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressInvoices: mocks.useAddressInvoices,
  useProxyForwardingMutations: mocks.useProxyForwardingMutations
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

import { AddressInvoicesCard } from '@/components/wallet/address-invoices-card'

describe('AddressInvoicesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refetch.mockResolvedValue(undefined)
    mocks.retryForwarding.mockResolvedValue({
      success: true,
      action: 'retry',
      payment: {
        id: 'proxy-payment-1',
        status: 'COMPLETED',
        destination: 'bob@example.com',
        lastError: null
      }
    })
    mocks.changeDestination.mockResolvedValue({
      success: true,
      action: 'change_destination',
      payment: {
        id: 'proxy-payment-1',
        status: 'BLOCKED',
        destination: 'carol@example.org',
        lastError: 'Destination updated. Retry forwarding when ready.'
      }
    })
    mocks.useProxyForwardingMutations.mockReturnValue({
      retryForwarding: mocks.retryForwarding,
      changeDestination: mocks.changeDestination,
      recovering: false,
      recoveryError: null
    })
    mocks.useAddressInvoices.mockReturnValue({
      loading: false,
      error: null,
      refetch: mocks.refetch,
      data: {
        invoices: [
          {
            id: 'invoice-1',
            amountSats: 10,
            amountMsats: '10000',
            bolt11: 'lnbc1incoming',
            description: 'Proxy payment to bob@example.com',
            status: 'PAID',
            comment: null,
            paymentHash: 'a'.repeat(64),
            createdAt: '2026-02-01T00:00:00.000Z',
            paidAt: '2026-02-01T00:01:00.000Z',
            expiresAt: '2026-02-01T01:00:00.000Z',
            proxy: {
              id: 'proxy-payment-1',
              status: 'COMPLETED',
              destination: 'bob@example.com',
              feeBps: 50,
              grossAmountMsats: '10000',
              serviceFeeMsats: '50',
              destinationAmountMsats: '9950',
              forwardedAmountMsats: '9950',
              routingFeeMsats: '2',
              sourcePaidAt: '2026-02-01T00:01:00.000Z',
              forwardedAt: '2026-02-01T00:02:00.000Z',
              receiptEventId: null,
              receiptPublishedAt: null,
              retryCount: 0,
              lastError: null,
              createdAt: '2026-02-01T00:00:00.000Z',
              updatedAt: '2026-02-01T00:02:00.000Z',
              attemptCount: 1,
              attempts: [
                {
                  id: 'attempt-1',
                  attemptNo: 1,
                  bolt11: 'lnbc1destination',
                  paymentHash: 'b'.repeat(64),
                  amountMsats: '9950',
                  status: 'SUCCEEDED',
                  routingFeeMsats: '2',
                  errorCode: null,
                  errorMessage: null,
                  expiresAt: '2026-02-01T01:00:00.000Z',
                  createdAt: '2026-02-01T00:01:30.000Z',
                  resolvedAt: '2026-02-01T00:02:00.000Z'
                }
              ]
            }
          }
        ]
      }
    })
  })

  it('opens a detailed receive, fee, and proxy invoice ledger', () => {
    render(<AddressInvoicesCard username="proxy" />)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'View details for Proxy payment to bob@example.com'
      })
    )

    expect(
      screen.getByRole('heading', { name: 'Proxy payment details' })
    ).toBeInTheDocument()
    expect(screen.getAllByText('Incoming invoice')).toHaveLength(2)
    expect(screen.getByText('Destination invoice · #1')).toBeInTheDocument()
    expect(screen.getByText('−0.05 sats')).toBeInTheDocument()
    expect(screen.getAllByText('9.95 sats')).not.toHaveLength(0)
    expect(screen.getByText('lnbc1incoming')).toBeInTheDocument()
    expect(screen.getByText('lnbc1destination')).toBeInTheDocument()
  })

  it('offers a safe destination change and manual retry for blocked forwarding', async () => {
    const result = mocks.useAddressInvoices()
    const invoice = result.data.invoices[0]
    mocks.useAddressInvoices.mockReturnValue({
      ...result,
      data: {
        invoices: [
          {
            ...invoice,
            proxy: {
              ...invoice.proxy,
              status: 'BLOCKED',
              forwardedAmountMsats: null,
              routingFeeMsats: null,
              forwardedAt: null,
              lastError:
                'Destination invoice amount does not match proxy amount',
              attemptCount: 0,
              attempts: []
            }
          }
        ]
      }
    })

    render(<AddressInvoicesCard username="proxy" />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'View details for Proxy payment to bob@example.com'
      })
    )

    expect(
      screen.getByRole('button', { name: 'Retry forwarding' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change address' }))
    fireEvent.change(screen.getByLabelText('New Lightning Address'), {
      target: { value: 'carol@example.org' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save destination' }))

    await waitFor(() => {
      expect(mocks.changeDestination).toHaveBeenCalledWith('carol@example.org')
    })
    expect(mocks.refetch).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry forwarding' }))
    await waitFor(() => {
      expect(mocks.retryForwarding).toHaveBeenCalled()
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Forwarding completed')
  })
})
