import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createLightningAddressFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

// The cb route now mints through the driver registry → NWC driver →
// `getServerNwcClient` → `@getalby/sdk` NWCClient.makeInvoice. Mock the
// NWCClient so we never touch a relay; the response shape mirrors NIP-47
// `make_invoice` (msats, expiry in unix seconds).
const makeInvoiceMock = vi.fn().mockResolvedValue({
  invoice: 'lnbc100n1test',
  payment_hash: 'a'.repeat(64),
  amount: 100_000,
  description: '',
  expires_at: 1_700_000_600,
})
const nwcCtorMock = vi.fn()

vi.mock('@getalby/sdk', () => ({
  NWCClient: vi.fn().mockImplementation((opts: { nostrWalletConnectUrl: string }) => {
    nwcCtorMock(opts)
    return { makeInvoice: makeInvoiceMock, close: vi.fn() }
  }),
}))

vi.mock('light-bolt11-decoder', () => ({
  decode: vi.fn().mockReturnValue({
    sections: [
      { name: 'timestamp', value: 1_700_000_000 },
      { name: 'expiry', value: 600 },
      { name: 'payment_hash', value: 'a'.repeat(64) },
    ],
  }),
}))

import { GET as Lud16Get } from '@/app/api/lud16/[username]/route'
import { GET as Lud16CbGet } from '@/app/api/lud16/[username]/cb/route'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'
import { getSettings } from '@/lib/settings'

/** A user's default RemoteWallet — the DEFAULT_NWC success path now needs one. */
const DEFAULT_WALLET = {
  type: 'NWC' as const,
  config: { connectionString: 'nostr+walletconnect://test', mode: 'SEND_RECEIVE' },
  status: 'ACTIVE' as const,
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // The driver caches one NWCClient per connection string; clear it so each
  // test's `nwcCtorMock` assertions see a fresh constructor call rather than
  // a cache hit from a prior test.
  closeAllServerNwcClients()
})

describe('GET /api/lud16/[username]', () => {
  it('returns LUD-06 pay response for valid username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'https://app.test.com' })

    const req = createNextRequest('/api/lud16/alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))
    const body: any = await assertResponse(res, 200)

    expect(body.status).toBe('OK')
    expect(body.tag).toBe('payRequest')
    expect(body.callback).toContain('/api/lud16/alice/cb')
    expect(body.minSendable).toBe(1000)
    expect(body.maxSendable).toBe(1000000000)
    expect(body.commentAllowed).toBe(200)
  })

  it('returns 404 for nonexistent username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/lud16/nonexistent')
    const res = await Lud16Get(req, createParamsPromise({ username: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('returns 404 when user has no NWC configured', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [] },
    } as any)

    const req = createNextRequest('/api/lud16/alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
  })

  it('handles case-insensitive username lookup', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'https://app.test.com' })

    const req = createNextRequest('/api/lud16/Alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'Alice' }))

    expect(res.status).toBe(200)
    expect(prismaMock.lightningAddress.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'alice' } })
    )
  })

  it('returns 404 for IDLE addresses even if a working NWC exists', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'IDLE',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)

    const req = createNextRequest('/api/lud16/alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
  })

  it('returns 404 for ALIAS addresses without a redirect target', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'ALIAS',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [] },
    } as any)

    const req = createNextRequest('/api/lud16/alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
  })

  it('proxies the remote LUD-16 response for ALIAS mode', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'ALIAS',
      redirect: 'bob@other.com',
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [] },
    } as any)

    const remoteBody = {
      status: 'OK',
      tag: 'payRequest',
      callback: 'https://other.com/lnurlp/bob/cb',
      minSendable: 1000,
      maxSendable: 1000000,
      metadata: '[["text/plain","Bob"]]',
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(remoteBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    try {
      const req = createNextRequest('/api/lud16/alice')
      const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://other.com/.well-known/lnurlp/bob',
        expect.objectContaining({ headers: expect.any(Object) }),
      )
      const body: any = await res.json()
      expect(body.callback).toBe('https://other.com/lnurlp/bob/cb')
      expect(body.tag).toBe('payRequest')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('returns 404 when the ALIAS remote LUD-16 fetch fails', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'ALIAS',
      redirect: 'bob@other.com',
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [] },
    } as any)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))

    try {
      const req = createNextRequest('/api/lud16/alice')
      const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))
      expect(res.status).toBe(404)
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('GET /api/lud16/[username]/cb', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'https://app.test.com' })
  })

  it('creates invoice and returns payment request', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const { eventBus } = await import('@/lib/events/event-bus')
    vi.mocked(eventBus.emit).mockClear()

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))
    const body: any = await assertResponse(res, 200)

    expect(body.pr).toBe('lnbc100n1test')
    expect(body.routes).toEqual([])
    expect(body.verify).toBe(
      `https://app.test.com/api/lud16/alice/verify/${'a'.repeat(64)}`
    )
    // A fresh invoice must announce itself on the bus so any connected
    // dashboard (address detail / admin home / invoices feed) refetches
    // without a manual reload.
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' }),
    )
  })

  it('persists invoice to DB with LUD16_PAYMENT purpose', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(prismaMock.invoice.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentHash: 'a'.repeat(64) },
        create: expect.objectContaining({
          bolt11: 'lnbc100n1test',
          paymentHash: 'a'.repeat(64),
          amountSats: 10,
          purpose: 'LUD16_PAYMENT',
          status: 'PENDING',
          userId: 'user-1',
          metadata: { username: 'alice' },
        }),
      })
    )
  })

  it('returns 404 for nonexistent username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/lud16/nonexistent/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'nonexistent' }))

    expect(res.status).toBe(404)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('rejects missing amount parameter', async () => {
    const req = createNextRequest('/api/lud16/alice/cb')
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(400)
  })

  it('returns 404 when user has no NWC', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [] },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  // ─── LUD-12 (comment) ─────────────────────────────────────────────────

  it('includes LUD-12 comment in invoice description and metadata', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000', comment: 'Thanks for the coffee!' },
    })
    await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    // Description passed to NWC includes the comment
    expect(makeInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Payment to @alice: Thanks for the coffee!',
      })
    )

    // Metadata persisted with comment
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          description: 'Payment to @alice: Thanks for the coffee!',
          metadata: { username: 'alice', comment: 'Thanks for the coffee!' },
        }),
      })
    )
  })

  it('rejects comment longer than 200 chars', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000', comment: 'x'.repeat(201) },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(400)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('omits comment from description when not provided', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(makeInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Payment to @alice' })
    )
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          metadata: { username: 'alice' },
        }),
      })
    )
  })

  it('returns 404 for CUSTOM_NWC with no bound wallet (no legacy fallback)', async () => {
    // RemoteWallet is the only source now: a CUSTOM_NWC address with no
    // bound RemoteWallet is unconfigured — it must NOT fall back to any
    // user-level connection.
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'CUSTOM_NWC',
      redirect: null,
      remoteWallet: null,
      nwcConnection: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
    expect(nwcCtorMock).not.toHaveBeenCalled()
  })

  it('routes through the bound RemoteWallet for CUSTOM_NWC (preferred over legacy)', async () => {
    // The core of #234: an explicitly bound RemoteWallet wins over the
    // legacy nwcConnection on the same address.
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'CUSTOM_NWC',
      redirect: null,
      remoteWallet: {
        type: 'NWC',
        config: { connectionString: 'nostr+walletconnect://bound-wallet', mode: 'SEND_RECEIVE' },
        status: 'ACTIVE',
      },
      nwcConnection: { connectionString: 'nostr+walletconnect://legacy-must-not-be-used' },
      user: {
        id: 'user-1',
        nwc: null,
        remoteWallets: [],
        nwcConnections: [],
      },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', { searchParams: { amount: '10000' } })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(200)
    expect(nwcCtorMock).toHaveBeenCalledWith({
      nostrWalletConnectUrl: 'nostr+walletconnect://bound-wallet',
    })
  })

  it("routes through the user's default RemoteWallet for DEFAULT_NWC", async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      remoteWallet: null,
      nwcConnection: null,
      user: {
        id: 'user-1',
        nwc: 'nostr+walletconnect://legacy-must-not-be-used',
        remoteWallets: [
          {
            type: 'NWC',
            config: { connectionString: 'nostr+walletconnect://default-wallet', mode: 'RECEIVE' },
            status: 'ACTIVE',
          },
        ],
        nwcConnections: [],
      },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', { searchParams: { amount: '10000' } })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(200)
    expect(nwcCtorMock).toHaveBeenCalledWith({
      nostrWalletConnectUrl: 'nostr+walletconnect://default-wallet',
    })
  })

  it('returns 503 when the wallet driver fails to mint', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      remoteWallet: null,
      nwcConnection: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)
    makeInvoiceMock.mockRejectedValueOnce(new Error('relay timeout'))

    const req = createNextRequest('/api/lud16/alice/cb', { searchParams: { amount: '10000' } })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(503)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('returns 404 for IDLE addresses on the callback', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'IDLE',
      redirect: null,
      nwcConnection: null,
      remoteWallet: null,
      user: { id: 'user-1', remoteWallets: [DEFAULT_WALLET] },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })
})
