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

const requestPaymentMock = vi.fn().mockResolvedValue({
  invoice: { paymentRequest: 'lnbc100n1test' },
})

vi.mock('@getalby/sdk', () => ({
  LN: vi.fn().mockImplementation(() => ({
    requestPayment: requestPaymentMock,
  })),
  SATS: vi.fn((v: number) => v),
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
import { LN } from '@getalby/sdk'
const LNCtor = vi.mocked(LN)
import { getSettings } from '@/lib/settings'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/lud16/[username]', () => {
  it('returns LUD-06 pay response for valid username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'app' })

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
      user: { id: 'user-1', nwc: null, nwcConnections: [] },
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
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'app' })

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
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
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
      user: { id: 'user-1', nwc: null, nwcConnections: [] },
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
      user: { id: 'user-1', nwc: null, nwcConnections: [] },
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
      user: { id: 'user-1', nwc: null, nwcConnections: [] },
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
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com', endpoint: 'app' })
  })

  it('creates invoice and returns payment request', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

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
  })

  it('persists invoice to DB with LUD16_PAYMENT purpose', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'DEFAULT_NWC',
      redirect: null,
      nwcConnection: null,
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
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
      user: { id: 'user-1', nwc: null, nwcConnections: [] },
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
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
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
    expect(requestPaymentMock).toHaveBeenCalledWith(
      expect.anything(),
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
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
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
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(requestPaymentMock).toHaveBeenCalledWith(
      expect.anything(),
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

  it('uses the address-linked NWC for CUSTOM_NWC mode (ignores legacy User.nwc)', async () => {
    // Belt-and-braces check that CUSTOM_NWC picks the address's connection
    // and not the user-level legacy field — easy to regress if the resolver
    // ever silently falls back when the linked connection is missing.
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'CUSTOM_NWC',
      redirect: null,
      nwcConnection: { connectionString: 'nostr+walletconnect://custom-for-alice' },
      user: {
        id: 'user-1',
        nwc: 'nostr+walletconnect://legacy-must-not-be-used',
        nwcConnections: [
          { connectionString: 'nostr+walletconnect://primary-must-not-be-used' },
        ],
      },
    } as any)
    vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(200)
    expect(LNCtor).toHaveBeenCalledWith('nostr+walletconnect://custom-for-alice')
  })

  it('returns 404 for IDLE addresses on the callback', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      mode: 'IDLE',
      redirect: null,
      nwcConnection: null,
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test', nwcConnections: [] },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })
})
