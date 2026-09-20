import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReceiveAmountStep } from '@/components/wallet/receive/amount-step'
import {
  currenciesActions,
  __resetCurrenciesCacheForTests
} from '@/lib/client/currencies-store'
import { receiveActions, resetAllFlows } from '@/lib/client/wallet-flow-store'

const pushMock = vi.hoisted(() => vi.fn())
const makeInvoiceMock = vi.hoisted(() => vi.fn())
const ratesState = vi.hoisted(() => ({
  current: { USD: 100_000 } as Record<string, number> | null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: vi.fn()
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
  useSettings: () => ({ data: { lncurl_auto_create: 'false' } })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    apiClient: { post: vi.fn(), get: vi.fn() }
  })
}))

vi.mock('@/lib/client/nwc', () => ({
  makeInvoice: makeInvoiceMock,
  describeNwcError: (err: unknown) =>
    err instanceof Error ? err.message : 'nwc error'
}))

vi.mock('@/lib/client/use-yadio-ticker', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/use-yadio-ticker')>()
  return {
    ...actual,
    useYadioRates: () => ({
      rates: ratesState.current,
      btcUsd: ratesState.current?.USD ?? null,
      fetchedAt: 1,
      loading: false,
      error: null
    })
  }
})

describe('ReceiveAmountStep currency switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    resetAllFlows()
    ratesState.current = { USD: 100_000 }
    makeInvoiceMock.mockResolvedValue({
      bolt11: 'lnbc1test',
      paymentHash: 'hash',
      amountSats: 1,
      description: '',
      expiresAt: null
    })
  })

  it('shows the same currency switch as send and converts BTC to sats', async () => {
    const user = userEvent.setup()
    receiveActions.setAmount(100_000_000)
    render(<ReceiveAmountStep />)

    const toggle = screen.getByRole('group', { name: 'Display currency' })
    expect(toggle).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sats', pressed: true }))
    expect(screen.getByRole('button', { name: 'BTC', pressed: false }))
    expect(screen.queryByLabelText('Enter 00')).toBeNull()

    expect(screen.getByText('100,000,000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'BTC' }))

    expect(screen.getByRole('button', { name: 'BTC', pressed: true }))
    expect(screen.getByLabelText('Enter 00')).toBeInTheDocument()
    expect(screen.queryByText('100,000,000')).toBeNull()
    expect(document.querySelector('.tabular-nums .text-5xl')?.textContent).toBe(
      '1'
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(makeInvoiceMock).toHaveBeenCalledWith(
      'nostr+walletconnect://test',
      100_000_000,
      ''
    )
    expect(pushMock).toHaveBeenCalledWith('/wallet/receive/invoice')
  })

  it('mints the invoice in sats after entering a fiat amount', async () => {
    const user = userEvent.setup()
    currenciesActions.add('USD')
    render(<ReceiveAmountStep />)

    await user.click(screen.getByRole('button', { name: 'USD' }))
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByLabelText('Enter 0'))
    await user.click(screen.getByLabelText('Enter 0'))
    expect(screen.getByText('1.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(makeInvoiceMock).toHaveBeenCalledWith(
      'nostr+walletconnect://test',
      1000,
      ''
    )
  })

  it('hides the switch when only one display currency is active', () => {
    currenciesActions.remove('BTC')
    render(<ReceiveAmountStep />)

    expect(
      screen.queryByRole('group', { name: 'Display currency' })
    ).toBeNull()
  })

  it('falls back to sats when the selected currency is removed', async () => {
    const user = userEvent.setup()
    receiveActions.setAmount(100_000_000)
    render(<ReceiveAmountStep />)

    await user.click(screen.getByRole('button', { name: 'BTC' }))
    expect(document.querySelector('.tabular-nums .text-5xl')?.textContent).toBe(
      '1'
    )

    act(() => {
      currenciesActions.remove('BTC')
    })

    expect(
      screen.queryByRole('group', { name: 'Display currency' })
    ).toBeNull()
    expect(screen.getByText('100,000,000')).toBeInTheDocument()
  })

  it('does not mint stale sats while a fiat switch is waiting on rates', async () => {
    const user = userEvent.setup()
    ratesState.current = null
    currenciesActions.add('USD')
    receiveActions.setAmount(1000)
    const { rerender } = render(<ReceiveAmountStep />)

    await user.click(screen.getByRole('button', { name: 'USD' }))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(makeInvoiceMock).not.toHaveBeenCalled()

    ratesState.current = { USD: 100_000 }
    rerender(<ReceiveAmountStep />)

    expect(screen.getByText('1.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(makeInvoiceMock).toHaveBeenCalledWith(
      'nostr+walletconnect://test',
      1000,
      ''
    )
  })

  it('parses a typed fiat amount once rates arrive', async () => {
    const user = userEvent.setup()
    ratesState.current = null
    currenciesActions.add('USD')
    const { rerender } = render(<ReceiveAmountStep />)

    await user.click(screen.getByRole('button', { name: 'USD' }))
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByLabelText('Enter 0'))
    await user.click(screen.getByLabelText('Enter 0'))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    ratesState.current = { USD: 100_000 }
    rerender(<ReceiveAmountStep />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(makeInvoiceMock).toHaveBeenCalledWith(
      'nostr+walletconnect://test',
      1000,
      ''
    )
  })
})
