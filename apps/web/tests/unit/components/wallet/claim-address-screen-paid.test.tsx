import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiClientError } from '@/lib/client/api-client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: { domain: 'lawallet.io' }, loading: false })
}))

// Paid instance: creating an address straight away is refused with a 402.
const createAddressMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client/hooks/use-wallet-addresses', () => ({
  useAddressMutations: () => ({
    createAddress: createAddressMock,
    creating: false
  })
}))

const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { post: postMock, get: vi.fn() } })
}))

vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

import { ClaimAddressScreen } from '@/components/wallet/claim/claim-address-screen'

const INVOICE = {
  id: 'inv-1',
  bolt11: 'lnbc210n1test',
  paymentHash: 'c'.repeat(64),
  amountSats: 21,
  verify: 'https://provider.example/verify/xyz',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  // Username availability check.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true }) })
  )
  createAddressMock.mockRejectedValue(
    new ApiClientError(402, 'Registration requires payment.', 'PAYMENT_REQUIRED')
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function submitUsername() {
  await userEvent.type(screen.getByLabelText('Username'), 'satoshi')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /claim address/i })).toBeEnabled()
  )
  await userEvent.click(screen.getByRole('button', { name: /claim address/i }))
}

describe('ClaimAddressScreen — paid registration', () => {
  it('shows the invoice QR after the 402', async () => {
    postMock.mockResolvedValue(INVOICE)
    const { unmount } = render(<ClaimAddressScreen />)

    await submitUsername()

    expect(
      await screen.findByRole('heading', { name: /pay 21 sats/i })
    ).toBeTruthy()
    expect(postMock).toHaveBeenCalledWith('/api/invoices', {
      purpose: 'wallet-address',
      metadata: { username: 'satoshi' }
    })

    // Reaching the payment step starts a LUD-21 poller that runs for the
    // invoice's full lifetime. Unmount inside the test so its abort lands
    // before `vi.unstubAllGlobals()` restores the real `fetch` — otherwise a
    // surviving 3s interval fires against a real URL after teardown.
    unmount()
  })

  it('keeps the user on the payment step with a retry when the mint fails', async () => {
    // The exact failure seen on the beta instance: the configured Lightning
    // Address provider never answers, so no invoice can be minted. This used
    // to drop the user back on the username form with a toast that faded,
    // leaving the 402 as an unexplained dead end.
    postMock.mockRejectedValueOnce(
      new ApiClientError(
        503,
        'Lightning address callback failed (This operation was aborted)',
        'SERVICE_UNAVAILABLE'
      )
    )
    const { unmount } = render(<ClaimAddressScreen />)

    await submitUsername()

    expect(
      await screen.findByRole('heading', { name: /payment couldn’t be started/i })
    ).toBeTruthy()
    expect(screen.getByText(/This operation was aborted/)).toBeTruthy()

    // Retrying re-mints without making the user re-pick a username.
    postMock.mockResolvedValueOnce(INVOICE)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(
      await screen.findByRole('heading', { name: /pay 21 sats/i })
    ).toBeTruthy()

    unmount() // see above — stop the poller before globals are restored
  })
})
