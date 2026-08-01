import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useProxyPendingBalance: vi.fn(),
  useProxyPendingBalanceMutation: vi.fn(),
  refetch: vi.fn(),
  forwardPending: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useProxyPendingBalance: mocks.useProxyPendingBalance,
  useProxyPendingBalanceMutation: mocks.useProxyPendingBalanceMutation
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError
  }
}))

import { ProxyPendingBalanceCard } from '@/components/wallet/proxy-pending-balance-card'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refetch.mockResolvedValue(undefined)
  mocks.forwardPending.mockResolvedValue({
    success: true,
    queued: 1,
    reconciliation: { claimed: 1, completed: 1, failed: 0 }
  })
  mocks.useProxyPendingBalanceMutation.mockReturnValue({
    forwardPending: mocks.forwardPending,
    forwardingPending: false,
    forwardPendingError: null
  })
  mocks.useProxyPendingBalance.mockReturnValue({
    data: {
      pendingAmountMsats: '9950',
      pendingPaymentCount: 1,
      blockedPaymentCount: 1,
      inFlightPaymentCount: 0,
      oldestPendingAt: new Date(Date.now() - 60_000).toISOString(),
      destination: 'agustin@primal.net'
    },
    loading: false,
    error: null,
    refetch: mocks.refetch
  })
})

describe('ProxyPendingBalanceCard', () => {
  it('shows the exact net amount and forwards safe pending funds', async () => {
    render(
      <ProxyPendingBalanceCard
        username="proxy"
        configuredDestination="agustin@primal.net"
      />
    )

    expect(screen.getByText('9.95 sats')).toBeInTheDocument()
    expect(screen.getByText('1 blocked')).toBeInTheDocument()
    expect(
      screen.getByText('Net amount across 1 payment, after service fees.')
    ).toBeInTheDocument()
    expect(screen.getByText('agustin@primal.net')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Forward pending funds' })
    )
    await waitFor(() => expect(mocks.forwardPending).toHaveBeenCalledOnce())
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '1 pending payment forwarded'
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh pending balance' })
    )
    expect(mocks.refetch).toHaveBeenCalledTimes(2)
  })

  it('disables manual forwarding while an outgoing attempt is active', () => {
    mocks.useProxyPendingBalance.mockReturnValue({
      data: {
        pendingAmountMsats: '9950',
        pendingPaymentCount: 1,
        blockedPaymentCount: 0,
        inFlightPaymentCount: 1,
        oldestPendingAt: new Date(Date.now() - 60_000).toISOString(),
        destination: 'agustin@primal.net'
      },
      loading: false,
      error: null,
      refetch: mocks.refetch
    })

    render(
      <ProxyPendingBalanceCard
        username="proxy"
        configuredDestination="agustin@primal.net"
      />
    )

    expect(
      screen.getByRole('button', { name: 'Pending funds are forwarding' })
    ).toBeDisabled()
    expect(screen.getByText('1 resolving')).toBeInTheDocument()
  })

  it('renders a settled zero state instead of an empty proxy placeholder', () => {
    mocks.useProxyPendingBalance.mockReturnValue({
      data: {
        pendingAmountMsats: '0',
        pendingPaymentCount: 0,
        blockedPaymentCount: 0,
        inFlightPaymentCount: 0,
        oldestPendingAt: null,
        destination: 'agustin@primal.net'
      },
      loading: false,
      error: null,
      refetch: mocks.refetch
    })

    render(
      <ProxyPendingBalanceCard
        username="proxy"
        configuredDestination="agustin@primal.net"
      />
    )

    expect(screen.getByText('0 sats')).toBeInTheDocument()
    expect(
      screen.getByText('All confirmed proxy payments have been forwarded.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/blocked/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /forward pending/i })
    ).not.toBeInTheDocument()
  })
})
