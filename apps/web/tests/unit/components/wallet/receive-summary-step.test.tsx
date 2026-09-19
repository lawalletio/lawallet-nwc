import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReceiveSummaryStep } from '@/components/wallet/receive/summary-step'
import { receiveActions, resetAllFlows } from '@/lib/client/wallet-flow-store'
import {
  currenciesActions,
  __resetCurrenciesCacheForTests
} from '@/lib/client/currencies-store'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const replaceMock = vi.hoisted(() => vi.fn())
const shareMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const PAYMENT_HASH =
  'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'
const PREIMAGE =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: vi.fn()
}))

vi.mock('@/lib/client/use-yadio-ticker', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/use-yadio-ticker')>()
  return {
    ...actual,
    useYadioRates: () => ({
      rates: { USD: 100_000 },
      btcUsd: 100_000,
      fetchedAt: Date.now(),
      loading: false,
      error: null
    })
  }
})

function mockShare(value: typeof shareMock | undefined) {
  shareMock.mockReset()
  shareMock.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    writable: true,
    value
  })
}

function seedInvoice(
  overrides: Partial<{
    paymentHash: string
    amountSats: number
    description: string
    preimage: string
    settledAt: number
  }> = {}
) {
  receiveActions.setInvoice({
    bolt11: 'lnbc210n1test',
    paymentHash: overrides.paymentHash ?? PAYMENT_HASH,
    amountSats: overrides.amountSats ?? 21000,
    description: overrides.description ?? 'Coffee',
    expiresAt: null
  })
  receiveActions.markSettled(
    overrides.preimage ?? '',
    overrides.settledAt ?? 1_726_747_200_000
  )
}

describe('ReceiveSummaryStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    resetAllFlows()
    mockShare(shareMock)
  })

  afterEach(() => {
    resetAllFlows()
    window.history.replaceState({}, '', '/')
  })

  it('redirects back to receive when there is no invoice', async () => {
    render(<ReceiveSummaryStep />)

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/wallet/receive')
    })
    expect(screen.queryByText('Payment received')).toBeNull()
  })

  it('shows amount, note, and payment hash', () => {
    seedInvoice()
    render(<ReceiveSummaryStep />)

    expect(
      screen.getByRole('heading', { name: 'Payment received' })
    ).toBeInTheDocument()
    expect(screen.getByText('21,000')).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText('Settled')).toBeInTheDocument()
    expect(screen.getByText(PAYMENT_HASH)).toBeInTheDocument()
    expect(screen.queryByText('Network fee')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show preimage' })).toBeNull()
  })

  it('reveals a real preimage when it differs from the payment hash', () => {
    seedInvoice({ preimage: PREIMAGE })
    render(<ReceiveSummaryStep />)

    expect(
      screen.getByRole('button', { name: 'Show preimage' })
    ).toBeInTheDocument()
    expect(screen.queryByText(PREIMAGE)).toBeNull()
  })

  it('does not treat the payment hash as a preimage', () => {
    seedInvoice({ preimage: PAYMENT_HASH })
    render(<ReceiveSummaryStep />)

    expect(screen.queryByRole('button', { name: 'Show preimage' })).toBeNull()
  })

  it('switches the amount into BTC', async () => {
    const user = userEvent.setup()
    seedInvoice()
    render(<ReceiveSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'BTC' }))

    expect(screen.getByText('0.00021000')).toBeInTheDocument()
    expect(screen.getByText('21,000 sats')).toBeInTheDocument()
  })

  it('shares a receipt that includes amount, note, and proof', async () => {
    const user = userEvent.setup()
    seedInvoice()
    render(<ReceiveSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(shareMock).toHaveBeenCalledTimes(1)
    const payload = shareMock.mock.calls[0]?.[0] as { text?: string }
    expect(payload.text).toContain('LaWallet payment receipt')
    expect(payload.text).toContain('Amount: 21,000 sats')
    expect(payload.text).toContain('Note: Coffee')
    expect(payload.text).toContain(PAYMENT_HASH)
    expect(payload.text).not.toContain('Fee:')
  })

  it('sends Done to home instead of bouncing back to receive', async () => {
    const user = userEvent.setup()
    seedInvoice()
    render(<ReceiveSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/wallet')
    })
    expect(replaceMock).not.toHaveBeenCalledWith('/wallet/receive')
  })

  it('seeds a local preview receipt without tracking completion', async () => {
    window.history.replaceState({}, '', '/wallet/receive/summary?preview=1')
    render(<ReceiveSummaryStep />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Payment received' })
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      AnalyticsEvent.WALLET_RECEIVE_COMPLETED
    )
  })

  it('sends preview Done to home without bouncing to receive', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/wallet/receive/summary?preview=1')
    render(<ReceiveSummaryStep />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Payment received' })
      ).toBeInTheDocument()
    })

    replaceMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/wallet')
    })
    expect(replaceMock).not.toHaveBeenCalledWith('/wallet/receive')
  })

  it('can show a fiat amount when that currency is active', async () => {
    const user = userEvent.setup()
    act(() => {
      currenciesActions.add('USD')
    })
    seedInvoice()
    render(<ReceiveSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'USD' }))

    expect(screen.getByText('21.00')).toBeInTheDocument()
  })
})
