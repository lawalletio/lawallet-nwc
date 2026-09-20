import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ReceiveAmountStep } from '@/components/wallet/receive/amount-step'
import {
  receiveActions,
  resetAllFlows,
  useReceiveFlow
} from '@/lib/client/wallet-flow-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({
    data: {
      effectiveNwcString: 'nostr+walletconnect://test',
      nwcString: 'nostr+walletconnect://test'
    },
    loading: false,
    error: null,
    refetch: async () => undefined
  }),
  invalidateApiPath: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({
    data: { lncurl_auto_create: 'false' },
    loading: false
  })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { post: vi.fn(), get: vi.fn() } })
}))

vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: vi.fn()
}))

function ReceiveStoreProbe() {
  const flow = useReceiveFlow()
  return (
    <div
      data-testid="receive-store"
      data-amount={flow.amountSats ?? ''}
      data-description={flow.description}
      data-invoice={flow.invoice?.bolt11 ?? ''}
    />
  )
}

function seedStaleReceive() {
  receiveActions.setAmount(2100)
  receiveActions.setDescription('coffee')
  receiveActions.setInvoice({
    bolt11: 'lnbc21u1stale',
    paymentHash: 'stale-hash',
    amountSats: 2100,
    description: 'coffee',
    expiresAt: null
  })
}

describe('ReceiveAmountStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllFlows()
  })

  afterEach(() => {
    resetAllFlows()
  })

  it('restarts the keypad and receive store when the amount page is opened', async () => {
    seedStaleReceive()

    render(
      <>
        <ReceiveStoreProbe />
        <ReceiveAmountStep />
      </>
    )

    expect(document.querySelector('.text-5xl')?.textContent).toBe('0')
    expect(screen.getByPlaceholderText('Add a note (optional)')).toHaveValue('')
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()

    await waitFor(() => {
      const probe = screen.getByTestId('receive-store')
      expect(probe).toHaveAttribute('data-amount', '')
      expect(probe).toHaveAttribute('data-description', '')
      expect(probe).toHaveAttribute('data-invoice', '')
    })
  })
})
