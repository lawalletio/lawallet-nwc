import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Race-condition regression tests for `useNwcBalance`.
 *
 * `fetchOnce()` is fired from two independent sources — a polling
 * `setInterval` and the un-awaited NIP-47 notification callback — so two
 * `getBalance()` requests can be in flight at once. These tests pin the
 * per-request-id guard: only the *latest* in-flight fetch may commit
 * `status`/`error`/`sats` and fire transition toasts. An older fetch that
 * settles after a newer one must be ignored.
 */

const {
  getBalanceMock,
  subscribeNotificationsMock,
  closeMock,
  toastErrorMock,
  toastSuccessMock
} = vi.hoisted(() => ({
  getBalanceMock: vi.fn(),
  subscribeNotificationsMock: vi.fn(),
  closeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn()
}))

// Captured per-mount so a test can drive `subscribeNotifications` callbacks.
let notifyCb: ((n: unknown) => void) | null = null

vi.mock('@getalby/sdk', () => {
  class FakeNWCClient {
    constructor(_opts: { nostrWalletConnectUrl: string }) {}
    getBalance = getBalanceMock
    close = closeMock
    subscribeNotifications = subscribeNotificationsMock
  }
  return { NWCClient: FakeNWCClient }
})

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock
  }
}))

import { useNwcBalance } from '@/lib/client/use-nwc-balance'

const NWC = 'nostr+walletconnect://b88cff...'

// A minimal `payment_received` Nip47Notification payload.
const TX = {
  type: 'incoming' as const,
  amount: 1_000_000,
  fees_paid: 0,
  description: '',
  payment_hash: 'hash',
  settled_at: Math.floor(Date.now() / 1000)
}
const NOTIFICATION = { notification_type: 'payment_received', notification: TX }

function Harness({
  nwc,
  announceStatus
}: {
  nwc: string
  announceStatus?: boolean
}) {
  const bal = useNwcBalance(nwc, {
    pollMs: 100_000,
    announceStatus: announceStatus ?? false
  })
  return (
    <div
      data-testid="hook"
      data-status={bal.status}
      data-loading={String(bal.loading)}
      data-sats={bal.sats ?? ''}
      data-error={bal.error?.message ?? ''}
    />
  )
}

async function connected() {
  await waitFor(() =>
    expect(screen.getByTestId('hook')).toHaveAttribute(
      'data-status',
      'connected'
    )
  )
  await waitFor(() => expect(subscribeNotificationsMock).toHaveBeenCalled())
}

function fireNotification() {
  expect(notifyCb).not.toBeNull()
  // Wrap in act(): the notification callback synchronously calls
  // `setLoading(true)` before the await, which is a React state update.
  act(() => {
    notifyCb!(NOTIFICATION)
  })
}

describe('useNwcBalance stale-fetch guard', () => {
  beforeEach(() => {
    getBalanceMock.mockReset()
    subscribeNotificationsMock.mockReset()
    closeMock.mockReset()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    notifyCb = null
    subscribeNotificationsMock.mockImplementation(cb => {
      notifyCb = cb
      return Promise.resolve(() => {})
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('a stale failure does not overwrite a newer success', async () => {
    // Initial fetch succeeds → connected.
    getBalanceMock.mockResolvedValueOnce({ balance: 1_000_000 })

    // Notification B hangs, then will time out (stale failure).
    // Notification C resolves (newer success).
    let rejectB!: (e: Error) => void
    let resolveC!: (v: { balance: number }) => void
    getBalanceMock
      .mockImplementationOnce(
        () =>
          new Promise<never>((_, rej) => {
            rejectB = rej
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ balance: number }>(res => {
            resolveC = res
          })
      )

    render(<Harness nwc={NWC} announceStatus />)
    await connected()

    // Fire both notifications. B starts (reqId=2) before C (reqId=3).
    fireNotification()
    fireNotification()
    await waitFor(() => expect(getBalanceMock).toHaveBeenCalledTimes(3))

    // The newer request (C) resolves first → connected, fresh balance.
    resolveC({ balance: 2_000_000 })
    await waitFor(() =>
      expect(screen.getByTestId('hook')).toHaveAttribute('data-sats', '2000')
    )
    expect(screen.getByTestId('hook')).toHaveAttribute(
      'data-status',
      'connected'
    )

    // The older request (B) now rejects with a timeout. Before the fix this
    // clobbered the newer success and fired a spurious disconnect toast.
    rejectB(new Error('reply timeout: event get_balance'))
    await Promise.resolve()

    expect(screen.getByTestId('hook')).toHaveAttribute(
      'data-status',
      'connected'
    )
    expect(screen.getByTestId('hook')).toHaveAttribute('data-loading', 'false')
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('a stale success does not overwrite a newer failure', async () => {
    // Initial fetch succeeds → connected.
    getBalanceMock.mockResolvedValueOnce({ balance: 1_000_000 })

    // Notification B hangs, then resolves later (stale success).
    // Notification C rejects (newer failure).
    let resolveB!: (v: { balance: number }) => void
    let rejectC!: (e: Error) => void
    getBalanceMock
      .mockImplementationOnce(
        () =>
          new Promise<{ balance: number }>(res => {
            resolveB = res
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<never>((_, rej) => {
            rejectC = rej
          })
      )

    render(<Harness nwc={NWC} announceStatus />)
    await connected()

    // B then C. The newer request (C) is the one that should own state.
    fireNotification()
    fireNotification()
    await waitFor(() => expect(getBalanceMock).toHaveBeenCalledTimes(3))

    // The newer request (C) rejects first → disconnected + one toast.
    rejectC(new Error('reply timeout: event get_balance'))
    await waitFor(() =>
      expect(screen.getByTestId('hook')).toHaveAttribute(
        'data-status',
        'disconnected'
      )
    )
    expect(toastErrorMock).toHaveBeenCalledTimes(1)

    // The older request (B) now resolves. Before the fix this clobbered the
    // newer failure and fired a spurious "Wallet reconnected" toast.
    resolveB({ balance: 5_000_000 })
    await Promise.resolve()

    expect(screen.getByTestId('hook')).toHaveAttribute(
      'data-status',
      'disconnected'
    )
    expect(screen.getByTestId('hook')).toHaveAttribute('data-loading', 'false')
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('a fresh notification still updates the balance (no regression)', async () => {
    getBalanceMock.mockResolvedValue({ balance: 1_000_000 })

    render(<Harness nwc={NWC} announceStatus />)
    await connected()
    expect(screen.getByTestId('hook')).toHaveAttribute('data-sats', '1000')

    getBalanceMock.mockResolvedValueOnce({ balance: 3_000_000 })
    fireNotification()

    await waitFor(() =>
      expect(screen.getByTestId('hook')).toHaveAttribute('data-sats', '3000')
    )
    expect(screen.getByTestId('hook')).toHaveAttribute(
      'data-status',
      'connected'
    )
  })

  it('a genuine failure then recovery still fires the transition toasts (no regression)', async () => {
    getBalanceMock.mockResolvedValueOnce({ balance: 1_000_000 })

    render(<Harness nwc={NWC} announceStatus />)
    await connected()

    // Sequential (non-overlapping) failure then success — the per-request
    // guard must not suppress legitimate transitions, only stale ones.
    getBalanceMock.mockImplementationOnce(() =>
      Promise.reject(new Error('reply timeout: event get_balance'))
    )
    fireNotification()
    await waitFor(() =>
      expect(screen.getByTestId('hook')).toHaveAttribute(
        'data-status',
        'disconnected'
      )
    )
    expect(toastErrorMock).toHaveBeenCalledTimes(1)

    getBalanceMock.mockResolvedValueOnce({ balance: 2_000_000 })
    fireNotification()
    await waitFor(() =>
      expect(screen.getByTestId('hook')).toHaveAttribute(
        'data-status',
        'connected'
      )
    )
    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('hook')).toHaveAttribute('data-sats', '2000')
  })
})
