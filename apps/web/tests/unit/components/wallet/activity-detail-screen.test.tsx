import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityDetailScreen } from '@/components/wallet/activity/activity-detail-screen'
import {
  rememberActivityTx,
  __resetActivityDetailStoreForTests
} from '@/lib/client/activity-detail-store'
import { __resetCurrenciesCacheForTests } from '@/lib/client/currencies-store'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'

const replaceMock = vi.hoisted(() => vi.fn())
const lookupTransactionMock = vi.hoisted(() => vi.fn())
const readByPaymentHashMock = vi.hoisted(() => vi.fn())
const shareMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const HASH = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'
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

vi.mock('@/lib/client/nwc', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/client/nwc')>()
  return {
    ...actual,
    lookupTransaction: lookupTransactionMock
  }
})

vi.mock('@/lib/client/cache/activity-cache', () => ({
  readByPaymentHash: readByPaymentHashMock,
  upsertMany: vi.fn()
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

const SETTLED_IN: NwcTransaction = {
  type: 'incoming',
  amountSats: 21000,
  feesPaidSats: 0,
  description: 'Coffee',
  paymentHash: HASH,
  preimage: PREIMAGE,
  settledAt: 1_726_747_200_000,
  createdAt: 1_726_747_200_000,
  state: 'settled'
}

const SETTLED_OUT: NwcTransaction = {
  type: 'outgoing',
  amountSats: 21000,
  feesPaidSats: 3,
  description: 'satoshi@example.com',
  paymentHash: HASH,
  preimage: PREIMAGE,
  settledAt: 1_726_747_200_000,
  createdAt: 1_726_747_200_000,
  state: 'settled'
}

const PENDING_IN: NwcTransaction = {
  type: 'incoming',
  amountSats: 1000,
  feesPaidSats: 0,
  description: '',
  paymentHash: HASH,
  preimage: null,
  settledAt: null,
  createdAt: 1_726_747_200_000,
  state: 'pending'
}

const FAILED_OUT: NwcTransaction = {
  type: 'outgoing',
  amountSats: 500,
  feesPaidSats: 0,
  description: 'alice@example.com',
  paymentHash: HASH,
  preimage: null,
  settledAt: null,
  createdAt: 1_726_747_200_000,
  state: 'failed'
}

function mockShare() {
  shareMock.mockReset()
  shareMock.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    writable: true,
    value: shareMock
  })
}

describe('ActivityDetailScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    __resetCurrenciesCacheForTests()
    __resetActivityDetailStoreForTests()
    lookupTransactionMock.mockResolvedValue(null)
    readByPaymentHashMock.mockResolvedValue(null)
    mockShare()
    window.history.replaceState({}, '', '/')
  })

  it('renders a receive-style receipt for an incoming transaction', async () => {
    rememberActivityTx(SETTLED_IN)
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    expect(
      await screen.findByRole('heading', { name: 'Payment received' })
    ).toBeInTheDocument()
    expect(screen.getByText('Settled')).toBeInTheDocument()
    expect(screen.getByText('21,000')).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText(HASH)).toBeInTheDocument()
    expect(screen.queryByText('Network fee')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show preimage' })
    ).toBeInTheDocument()
  })

  it('renders a send-style receipt for an outgoing transaction', async () => {
    rememberActivityTx(SETTLED_OUT)
    render(<ActivityDetailScreen paymentHash={HASH} />)

    expect(
      await screen.findByRole('heading', { name: 'Payment sent' })
    ).toBeInTheDocument()
    expect(screen.getByText('Network fee')).toBeInTheDocument()
    expect(screen.getByText('satoshi@example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show preimage' })
    ).toBeInTheDocument()
  })

  it('shows pending status instead of a dead click', async () => {
    rememberActivityTx(PENDING_IN)
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    expect(
      await screen.findByRole('heading', { name: 'Payment pending' })
    ).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('Settled')).toBeNull()
  })

  it('shows failed status for a failed send', async () => {
    rememberActivityTx(FAILED_OUT)
    render(<ActivityDetailScreen paymentHash={HASH} />)

    expect(
      await screen.findByRole('heading', { name: 'Payment failed' })
    ).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('sends Back and Done to /wallet when opened from home activity', async () => {
    const user = userEvent.setup()
    rememberActivityTx(SETTLED_IN)
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    await screen.findByRole('heading', { name: 'Payment received' })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(replaceMock).toHaveBeenCalledWith('/wallet')

    replaceMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(replaceMock).toHaveBeenCalledWith('/wallet')
  })

  it('sends Back to the activity list when opened from /wallet/activity', async () => {
    const user = userEvent.setup()
    rememberActivityTx(SETTLED_OUT)
    render(<ActivityDetailScreen paymentHash={HASH} />)

    await screen.findByRole('heading', { name: 'Payment sent' })
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(replaceMock).toHaveBeenCalledWith('/wallet/activity')
  })

  it('shows not found when the hash is unknown', async () => {
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    expect(
      await screen.findByText('Transaction not found.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to activity' })
    ).toBeInTheDocument()
  })

  it('hydrates from the activity cache when the in-memory stash is empty', async () => {
    readByPaymentHashMock.mockResolvedValue(SETTLED_IN)
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    expect(
      await screen.findByRole('heading', { name: 'Payment received' })
    ).toBeInTheDocument()
    expect(readByPaymentHashMock).toHaveBeenCalled()
  })

  it('shares a receipt that includes status and proof', async () => {
    const user = userEvent.setup()
    rememberActivityTx(SETTLED_IN)
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    await screen.findByRole('heading', { name: 'Payment received' })
    await user.click(screen.getByRole('button', { name: 'Share' }))

    expect(shareMock).toHaveBeenCalledTimes(1)
    const payload = shareMock.mock.calls[0]?.[0] as { text?: string }
    expect(payload.text).toContain('Status: Settled')
    expect(payload.text).toContain('Note: Coffee')
    expect(payload.text).toContain(HASH)
  })

  it('seeds a local preview receipt without a live wallet', async () => {
    window.history.replaceState(
      {},
      '',
      `/wallet/activity/${HASH}?preview=1&from=home`
    )
    render(<ActivityDetailScreen paymentHash={HASH} from="home" />)

    expect(
      await screen.findByRole('heading', { name: 'Payment received' })
    ).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
  })
})
