import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SendSummaryStep } from '@/components/wallet/send/summary-step'
import {
  resetAllFlows,
  sendActions,
  type SendFlowResult
} from '@/lib/client/wallet-flow-store'
import {
  currenciesActions,
  __resetCurrenciesCacheForTests
} from '@/lib/client/currencies-store'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const replaceMock = vi.hoisted(() => vi.fn())
const writeTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const shareMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

function mockClipboard() {
  writeTextMock.mockReset()
  writeTextMock.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText: writeTextMock }
  })
}

function mockShare(value: typeof shareMock | undefined) {
  shareMock.mockReset()
  shareMock.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    writable: true,
    value
  })
}

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

const PREIMAGE =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const PAYMENT_HASH =
  'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'

function seedResult(overrides: Partial<SendFlowResult> = {}) {
  sendActions.setResult({
    preimage: PREIMAGE,
    feesPaidSats: 3,
    amountSats: 21000,
    recipient: 'Satoshi',
    paymentHash: PAYMENT_HASH,
    destination: 'satoshi@example.com',
    comment: 'Coffee',
    settledAt: 1_726_747_200_000,
    ...overrides
  })
}

describe('SendSummaryStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    resetAllFlows()
    mockClipboard()
    mockShare(shareMock)
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('redirects back to send when there is no result', async () => {
    render(<SendSummaryStep />)

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/wallet/send')
    })
    expect(screen.queryByText('Payment sent')).toBeNull()
  })

  it('shows amount, fee, destination, and masked preimage', () => {
    seedResult()
    render(<SendSummaryStep />)

    expect(
      screen.getByRole('heading', { name: 'Payment sent' })
    ).toBeInTheDocument()
    expect(screen.getByText('21,000')).toBeInTheDocument()
    expect(screen.getByText('3 sats')).toBeInTheDocument()
    expect(screen.getByText('Satoshi')).toBeInTheDocument()
    expect(screen.getByText('satoshi@example.com')).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText('Settled')).toBeInTheDocument()
    expect(screen.queryByText(PREIMAGE)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show preimage' })
    ).toBeInTheDocument()
  })

  it('still shows a zero network fee', () => {
    seedResult({ feesPaidSats: 0 })
    render(<SendSummaryStep />)

    expect(screen.getByText('0 sats')).toBeInTheDocument()
  })

  it('switches the amount and fee into BTC', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<SendSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'BTC' }))

    expect(screen.getByText('0.00021000')).toBeInTheDocument()
    expect(screen.getByText('0.00000003 BTC')).toBeInTheDocument()
    expect(screen.getByText('21,000 sats')).toBeInTheDocument()
  })

  it('reveals and copies the preimage', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<SendSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'Show preimage' }))
    expect(screen.getByText(PREIMAGE)).toBeInTheDocument()

    const writeSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Copy preimage' }))
    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith(PREIMAGE)
    })
  })

  it('shows an empty state when the wallet omitted proof fields', () => {
    seedResult({ preimage: '  ', paymentHash: null })
    render(<SendSummaryStep />)

    expect(screen.getAllByText('Not provided by wallet')).toHaveLength(2)
  })

  it('shares a receipt that includes amount, fee, and proof', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<SendSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(shareMock).toHaveBeenCalledTimes(1)
    const payload = shareMock.mock.calls[0]?.[0] as { text?: string }
    expect(payload.text).toContain('LaWallet payment receipt')
    expect(payload.text).toContain('Amount: 21,000 sats')
    expect(payload.text).toContain('Fee: 3 sats')
    expect(payload.text).toContain('satoshi@example.com')
    expect(payload.text).toContain(PREIMAGE)
    expect(payload.text).toContain(PAYMENT_HASH)
  })

  it('copies the receipt when the Web Share API is unavailable', async () => {
    const user = userEvent.setup()
    mockShare(undefined)
    const writeSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    seedResult()
    render(<SendSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('LaWallet payment receipt')
      )
    })
  })

  it('seeds a local preview receipt without tracking completion', async () => {
    window.history.replaceState({}, '', '/wallet/send/summary?preview=1')
    render(<SendSummaryStep />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Payment sent' })
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Satoshi')).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      AnalyticsEvent.WALLET_SEND_COMPLETED
    )
  })

  it('tracks completion for a real payment and Done returns home', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<SendSummaryStep />)

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith(
        AnalyticsEvent.WALLET_SEND_COMPLETED
      )
    })

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(replaceMock).toHaveBeenCalledWith('/wallet')
  })

  it('can show a fiat amount when that currency is active', async () => {
    const user = userEvent.setup()
    act(() => {
      currenciesActions.add('USD')
    })
    seedResult()
    render(<SendSummaryStep />)

    await user.click(screen.getByRole('button', { name: 'USD' }))

    expect(screen.getByText('21.00')).toBeInTheDocument()
    expect(screen.getByText('< 0.01 USD')).toBeInTheDocument()
  })
})
