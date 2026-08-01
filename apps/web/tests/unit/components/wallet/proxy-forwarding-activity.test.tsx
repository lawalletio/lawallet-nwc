import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAddressInvoices: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressInvoices: mocks.useAddressInvoices
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

import { ProxyForwardingActivity } from '@/components/wallet/proxy-forwarding-activity'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAddressInvoices.mockReturnValue({
    loading: false,
    error: null,
    data: {
      invoices: [
        {
          id: 'invoice-1',
          amountSats: 10,
          amountMsats: '10000',
          bolt11: 'lnbc1incoming',
          description: 'Proxy payment',
          status: 'PAID',
          comment: null,
          paymentHash: 'a'.repeat(64),
          createdAt: '2026-07-31T20:00:00.000Z',
          paidAt: '2026-07-31T20:01:00.000Z',
          expiresAt: '2026-07-31T21:00:00.000Z',
          proxy: {
            id: 'proxy-payment-1',
            status: 'BLOCKED',
            destination: 'agustin@primal.net',
            feeBps: 50,
            grossAmountMsats: '10000',
            serviceFeeMsats: '50',
            destinationAmountMsats: '9950',
            forwardedAmountMsats: null,
            routingFeeMsats: null,
            sourcePaidAt: '2026-07-31T20:01:00.000Z',
            forwardedAt: null,
            receiptEventId: null,
            receiptPublishedAt: null,
            retryCount: 2,
            nextRetryAt: '2026-07-31T20:10:00.000Z',
            leaseExpiresAt: null,
            lastError: 'Listener could not confirm the outgoing payment',
            createdAt: '2026-07-31T20:00:00.000Z',
            updatedAt: '2026-07-31T20:08:00.000Z',
            attemptCount: 2,
            attempts: [
              {
                id: 'attempt-2',
                attemptNo: 2,
                requestId: 'request-2',
                bolt11: 'lnbc1destination2',
                paymentHash: 'b'.repeat(64),
                amountMsats: '9950',
                status: 'UNKNOWN',
                routingFeeMsats: null,
                errorCode: 'timeout',
                errorMessage: 'Listener timed out while waiting',
                expiresAt: '2026-07-31T21:00:00.000Z',
                createdAt: '2026-07-31T20:07:00.000Z',
                updatedAt: '2026-07-31T20:08:00.000Z',
                resolvedAt: null
              },
              {
                id: 'attempt-1',
                attemptNo: 1,
                requestId: 'request-1',
                bolt11: 'lnbc1destination1',
                paymentHash: 'c'.repeat(64),
                amountMsats: '9950',
                status: 'REJECTED',
                routingFeeMsats: null,
                errorCode: 'payment_failed',
                errorMessage: 'No route found',
                expiresAt: '2026-07-31T21:00:00.000Z',
                createdAt: '2026-07-31T20:03:00.000Z',
                updatedAt: '2026-07-31T20:04:00.000Z',
                resolvedAt: '2026-07-31T20:04:00.000Z'
              }
            ]
          }
        }
      ]
    }
  })
})

describe('ProxyForwardingActivity', () => {
  it('shows payment state, every attempt, retry labels, and debug identifiers', () => {
    render(<ProxyForwardingActivity username="proxy" />)

    expect(
      screen.getByRole('heading', { name: 'Forwarding activity' })
    ).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(
      screen.getByText('Listener could not confirm the outgoing payment')
    ).toBeInTheDocument()
    expect(screen.getByText('Initial forward')).toBeInTheDocument()
    expect(screen.getByText('Retry #1')).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
    expect(screen.getByText('payment_failed')).toBeInTheDocument()
    expect(screen.getByText('request-2')).toBeInTheDocument()
    expect(screen.getByText('request-1')).toBeInTheDocument()
    expect(screen.getAllByText(/2 retries/).length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Refresh forwarding activity' })
    ).not.toBeInTheDocument()
  })

  it('shows an explicit empty state before the first proxy payment', () => {
    mocks.useAddressInvoices.mockReturnValue({
      loading: false,
      error: null,
      data: { invoices: [] }
    })

    render(<ProxyForwardingActivity username="proxy" />)

    expect(screen.getByText('No proxy activity yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Attempts will appear after the first payment is received.'
      )
    ).toBeInTheDocument()
  })
})
