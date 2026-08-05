import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/client/hooks/use-remote-wallet-forwarding', () => ({
  useRemoteWalletReceiveAction: vi.fn(),
  useRemoteWalletForwardReceipts: vi.fn(),
  useRemoteWalletForwardActivity: vi.fn(),
  useRemoteWalletPayment: vi.fn(),
  useRemoteWalletForwardingMutations: vi.fn()
}))

import { RemoteWalletForwardingPanel } from '@/components/wallet/remote-wallet-forwarding-panel'
import {
  useRemoteWalletForwardingMutations,
  useRemoteWalletForwardActivity,
  useRemoteWalletForwardReceipts,
  useRemoteWalletPayment,
  useRemoteWalletReceiveAction,
  type ForwardReceiptData
} from '@/lib/client/hooks/use-remote-wallet-forwarding'

const RECEIPT_PAYMENT_HASH = 'aa'.repeat(32)

function forwardingReceipt(
  overrides: Partial<ForwardReceiptData> = {}
): ForwardReceiptData {
  const now = '2026-08-04T00:00:00.000Z'
  return {
    id: 'receipt-1',
    walletId: 'wallet-1',
    eventKey: 'event-1',
    sourcePaymentHash: RECEIPT_PAYMENT_HASH,
    sourceInvoice: null,
    grossAmountMsats: 2_000,
    retainedFeeMsats: 0,
    targetAmountMsats: 2_000,
    forwardedAmountMsats: 2_000,
    routingFeeMsats: 0,
    routingReserveMsats: 0,
    unusedRoutingReserveMsats: 0,
    routingFeeOverageMsats: 0,
    shortfallMsats: 0,
    configRevision: 3,
    status: 'COMPLETED',
    recovered: false,
    sourceSettledAt: now,
    lastError: null,
    nextRetryAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    legs: [],
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(useRemoteWalletReceiveAction).mockReturnValue({
    data: {
      walletId: 'wallet-1',
      eligible: true,
      reason: null,
      configured: true,
      enabled: true,
      enabledAt: '2026-08-01T12:00:00.000Z',
      pausedAt: null,
      pendingReceipts: 0,
      pendingAmountMsats: 0,
      routingReserveBps: 100,
      routingReserveBaseSats: 1,
      revision: {
        number: 1,
        feeBps: 50,
        baseFeeSats: 1,
        destinations: [{ address: 'alice@example.com', allocationBps: 10_000 }]
      }
    },
    loading: false,
    error: null,
    refetch: vi.fn()
  } as never)
  vi.mocked(useRemoteWalletForwardReceipts).mockReturnValue({
    data: { receipts: [], nextCursor: null },
    loading: false,
    error: null,
    refetch: vi.fn()
  } as never)
  vi.mocked(useRemoteWalletForwardActivity).mockReturnValue({
    data: { activity: [], nextCursor: null },
    loading: false,
    error: null,
    refetch: vi.fn()
  } as never)
  vi.mocked(useRemoteWalletPayment).mockReturnValue({
    data: { zap: null },
    loading: false,
    error: null,
    refetch: vi.fn()
  } as never)
  vi.mocked(useRemoteWalletForwardingMutations).mockReturnValue({
    configure: vi.fn(),
    setEnabled: vi.fn(),
    retryReceipt: vi.fn(),
    forceForward: vi.fn(),
    forcing: false,
    loading: false,
    error: null
  })
})

describe('RemoteWalletForwardingPanel', () => {
  it('allows an active forwarding plan to be edited', () => {
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    expect(screen.getByRole('button', { name: 'Edit plan' })).not.toBeDisabled()
  })

  it('forces all pending receipts immediately', async () => {
    const forceForward = vi.fn().mockResolvedValue({
      accepted: true,
      forwardingReceipts: 3
    })
    const actionRefetch = vi.fn().mockResolvedValue(undefined)
    const receiptsRefetch = vi.fn().mockResolvedValue(undefined)
    const activityRefetch = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useRemoteWalletReceiveAction).mockReturnValue({
      data: {
        walletId: 'wallet-1',
        eligible: true,
        reason: null,
        configured: true,
        enabled: true,
        enabledAt: '2026-08-01T12:00:00.000Z',
        pausedAt: null,
        pendingReceipts: 3,
        pendingAmountMsats: 8_000,
        routingReserveBps: 100,
        routingReserveBaseSats: 1,
        revision: {
          number: 1,
          feeBps: 50,
          baseFeeSats: 1,
          destinations: [
            { address: 'alice@example.com', allocationBps: 10_000 }
          ]
        }
      },
      loading: false,
      error: null,
      refetch: actionRefetch
    } as never)
    vi.mocked(useRemoteWalletForwardReceipts).mockReturnValue({
      data: { receipts: [], nextCursor: null },
      loading: false,
      error: null,
      refetch: receiptsRefetch
    } as never)
    vi.mocked(useRemoteWalletForwardActivity).mockReturnValue({
      data: { activity: [], nextCursor: null },
      loading: false,
      error: null,
      refetch: activityRefetch
    } as never)
    vi.mocked(useRemoteWalletForwardingMutations).mockReturnValue({
      configure: vi.fn(),
      setEnabled: vi.fn(),
      retryReceipt: vi.fn(),
      forceForward,
      forcing: false,
      loading: false,
      error: null
    })
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Force Forward' }))

    expect(forceForward).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(actionRefetch).toHaveBeenCalledOnce()
      expect(receiptsRefetch).toHaveBeenCalledOnce()
      expect(activityRefetch).toHaveBeenCalledOnce()
    })
    expect(screen.getByRole('tab', { name: 'Forwarding' })).toHaveAttribute(
      'data-state',
      'active'
    )
    expect(screen.getByText('Attempt processing')).toBeInTheDocument()
    expect(
      screen.getByRole('status', {
        name: 'Forwarding attempt in progress'
      })
    ).toBeInTheDocument()
  })

  it('animates attempts while their outcome is in progress', async () => {
    vi.mocked(useRemoteWalletForwardActivity).mockReturnValue({
      data: {
        activity: [
          {
            id: 'attempt-1',
            receiptId: 'receipt-1',
            legId: 'leg-1',
            destination: 'alice@example.com',
            attemptNo: 1,
            amountMsats: 7_000,
            status: 'PENDING',
            errorMessage: null,
            createdAt: '2026-08-05T12:00:00.000Z'
          }
        ],
        nextCursor: null
      },
      loading: false,
      error: null,
      refetch: vi.fn()
    } as never)
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(screen.getByRole('tab', { name: 'Forwarding' }))

    const progress = screen.getByRole('status', {
      name: 'Forwarding attempt in progress'
    })
    expect(progress.querySelector('svg')).toHaveClass('animate-spin')
  })

  it('includes regular incoming wallet payments and paginates them', async () => {
    const transactions = Array.from({ length: 6 }, (_, index) => ({
      type: 'incoming' as const,
      amountSats: 100 + index,
      feesPaidSats: 0,
      description: `Regular payment ${index + 1}`,
      paymentHash: `hash-${index + 1}`,
      preimage: null,
      settledAt: Date.parse(
        `2026-08-03T12:${String(59 - index).padStart(2, '0')}:00.000Z`
      ),
      createdAt: Date.parse(
        `2026-08-03T12:${String(59 - index).padStart(2, '0')}:00.000Z`
      )
    }))
    render(
      <RemoteWalletForwardingPanel
        walletId="wallet-1"
        transactions={transactions}
      />
    )

    await userEvent.click(
      screen.getByRole('tab', { name: 'Payments received' })
    )
    expect(screen.getByText('Regular payment 1')).toBeInTheDocument()
    expect(screen.queryByText('Regular payment 6')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Next payments page' })
    )

    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByText('Regular payment 6')).toBeInTheDocument()
    expect(useRemoteWalletForwardReceipts).toHaveBeenLastCalledWith(
      'wallet-1',
      { limit: 100 }
    )
  })

  it('shows the reason for a blocked payment in the payments list', async () => {
    const reason =
      'Forwarding amount is too small for all configured destinations'
    vi.mocked(useRemoteWalletForwardReceipts).mockReturnValue({
      data: {
        receipts: [
          forwardingReceipt({
            id: 'receipt-blocked',
            forwardedAmountMsats: 0,
            status: 'BLOCKED',
            lastError: reason,
            completedAt: null
          })
        ],
        nextCursor: null
      },
      loading: false,
      error: null,
      refetch: vi.fn()
    } as never)
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(
      screen.getByRole('tab', { name: 'Payments received' })
    )

    expect(screen.getByText(reason)).toBeInTheDocument()
  })

  it('animates a receipt icon while its forwarding is in progress', async () => {
    vi.mocked(useRemoteWalletForwardReceipts).mockReturnValue({
      data: {
        receipts: [
          forwardingReceipt({
            status: 'PARTIAL',
            forwardedAmountMsats: 1_000,
            completedAt: null
          })
        ],
        nextCursor: null
      },
      loading: false,
      error: null,
      refetch: vi.fn()
    } as never)
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(
      screen.getByRole('tab', { name: 'Payments received' })
    )

    const progress = screen.getByRole('status', {
      name: 'Payment forwarding in progress'
    })
    expect(progress.querySelector('svg')).toHaveClass('animate-spin')
  })

  it('shows decoded zap request and receipt JSON in receipt tabs', async () => {
    vi.mocked(useRemoteWalletForwardReceipts).mockReturnValue({
      data: { receipts: [forwardingReceipt()], nextCursor: null },
      loading: false,
      error: null,
      refetch: vi.fn()
    } as never)
    vi.mocked(useRemoteWalletPayment).mockReturnValue({
      data: {
        zap: {
          request: { kind: 9734 },
          requestJson: JSON.stringify({
            kind: 9734,
            tags: [['description', JSON.stringify({ kind: 9734 })]]
          }),
          receipt: { kind: 9735 },
          receiptJson: JSON.stringify({ kind: 9735, content: '' }),
          receiptEventId: 'receipt-event-id',
          receiptPublishedAt: '2026-08-04T00:01:00.000Z',
          error: null,
          nextRetryAt: null
        }
      },
      loading: false,
      error: null,
      refetch: vi.fn()
    } as never)
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(
      screen.getByRole('tab', { name: 'Payments received' })
    )
    await userEvent.click(screen.getByText('Payment received'))

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Destinations' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Zap request' }))

    expect(screen.getByText('Kind 9734 event')).toBeInTheDocument()
    expect(document.querySelector('pre')).toHaveTextContent('"kind": 9734')
    expect(document.querySelector('pre')).not.toHaveTextContent('\\"kind\\"')

    await userEvent.click(screen.getByRole('tab', { name: 'Zap receipt' }))
    expect(screen.getByText('Kind 9735 event')).toBeInTheDocument()
    expect(screen.getByText('receipt-event-id')).toBeInTheDocument()
    expect(useRemoteWalletPayment).toHaveBeenCalledWith(
      'wallet-1',
      RECEIPT_PAYMENT_HASH
    )
  })

  it('paginates activity attempts independently with the server cursor', async () => {
    vi.mocked(useRemoteWalletForwardActivity).mockImplementation(
      (_walletId, options) =>
        ({
          data: {
            activity: [],
            nextCursor: options?.cursor ? null : 'activity-cursor-2'
          },
          loading: false,
          error: null,
          refetch: vi.fn()
        }) as never
    )
    render(<RemoteWalletForwardingPanel walletId="wallet-1" />)

    await userEvent.click(screen.getByRole('tab', { name: 'Forwarding' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Next forwarding page' })
    )

    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(useRemoteWalletForwardActivity).toHaveBeenLastCalledWith(
      'wallet-1',
      { cursor: 'activity-cursor-2', limit: 5 }
    )
  })
})
