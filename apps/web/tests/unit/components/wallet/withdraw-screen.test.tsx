import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { LnurlWithdrawParams } from '@/lib/client/lnurl-scan'

const replaceMock = vi.hoisted(() => vi.fn())
const makeInvoiceMock = vi.hoisted(() => vi.fn())
const lookupInvoiceMock = vi.hoisted(() => vi.fn())
const submitLnurlWithdrawMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
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
  })
}))

vi.mock('@/lib/client/nwc', () => ({
  makeInvoice: makeInvoiceMock,
  lookupInvoice: lookupInvoiceMock,
  describeNwcError: (err: unknown) =>
    err instanceof Error ? err.message : 'nwc error'
}))

vi.mock('@/lib/client/lnurl-scan', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/client/lnurl-scan')>()
  return {
    ...actual,
    submitLnurlWithdraw: submitLnurlWithdrawMock
  }
})

vi.mock('@/lib/analytics/gtag', () => ({ trackEvent: vi.fn() }))

import { WithdrawScreen } from '@/components/wallet/withdraw/withdraw-screen'
import { resetAllFlows, withdrawActions } from '@/lib/client/wallet-flow-store'

const VOUCHER: LnurlWithdrawParams = {
  callback: 'https://voucher.example/lnurl-withdraw',
  k1: 'already-claimed-k1',
  defaultDescription: 'Test voucher',
  minWithdrawableSats: 1000,
  maxWithdrawableSats: 1000,
  host: 'voucher.example'
}

function seedUnclaimed() {
  withdrawActions.setParams(VOUCHER)
}

function seedClaimed() {
  withdrawActions.setParams(VOUCHER)
  withdrawActions.setResult({ amountSats: 1000, settled: true })
}

async function flushLeaveReset() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('WithdrawScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllFlows()
    makeInvoiceMock.mockResolvedValue({
      bolt11: 'lnbc1test',
      paymentHash: 'hash'
    })
    lookupInvoiceMock.mockResolvedValue({ settled: true })
    submitLnurlWithdrawMock.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await flushLeaveReset()
    resetAllFlows()
  })

  it('shows the confirm CTA for an unclaimed voucher', () => {
    seedUnclaimed()
    render(<WithdrawScreen />)

    const cta = screen.getByRole('button', { name: /withdraw 1,000 sats/i })
    expect(cta).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Funds received' })).toBeNull()
  })

  it('shows success instead of confirm when the voucher was already claimed', () => {
    seedClaimed()
    render(<WithdrawScreen />)

    expect(screen.getByRole('heading', { name: 'Funds received' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull()
  })

  it('does not re-offer claim after leaving and remounting a claimed voucher', async () => {
    seedClaimed()
    const { unmount } = render(<WithdrawScreen />)
    expect(screen.getByRole('heading', { name: 'Funds received' })).toBeTruthy()

    unmount()
    await flushLeaveReset()

    render(<WithdrawScreen />)

    expect(replaceMock).toHaveBeenCalledWith('/wallet')
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Funds received' })).toBeNull()
  })

  it('does not re-submit claim when a result is already in the store', () => {
    seedClaimed()
    render(<WithdrawScreen />)

    expect(screen.getByRole('heading', { name: 'Funds received' })).toBeTruthy()
    expect(makeInvoiceMock).not.toHaveBeenCalled()
    expect(submitLnurlWithdrawMock).not.toHaveBeenCalled()
  })

  it('ignores a second Withdraw click while the first claim is in flight', async () => {
    let resolveInvoice: (value: {
      bolt11: string
      paymentHash: string
    }) => void = () => undefined
    makeInvoiceMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveInvoice = resolve
        })
    )

    seedUnclaimed()
    render(<WithdrawScreen />)

    const cta = screen.getByRole('button', { name: /withdraw 1,000 sats/i })
    fireEvent.click(cta)
    fireEvent.click(cta)

    expect(makeInvoiceMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInvoice({ bolt11: 'lnbc1test', paymentHash: 'hash' })
    })
  })
})
