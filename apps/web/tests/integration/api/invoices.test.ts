import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    rateLimit: { windowMs: 60000, max: 100, authMax: 1000 },
    requestLimits: { maxJsonBodySize: 102400 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi
    .fn()
    .mockResolvedValue({ pubkey: 'a'.repeat(64), role: 'USER', method: 'jwt' }),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

vi.mock('light-bolt11-decoder', () => ({
  decode: vi.fn().mockReturnValue({
    sections: [
      { name: 'timestamp', value: 1_700_000_000 },
      { name: 'expiry', value: 600 },
      { name: 'payment_hash', value: 'c'.repeat(64) },
    ],
  }),
}))

import { POST } from '@/app/api/invoices/route'
import { getSettings } from '@/lib/settings'

const originalFetch = global.fetch

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user-1',
    pubkey: 'a'.repeat(64),
  } as any)
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('POST /api/invoices', () => {
  it('returns { free: true } when no registration LN address is configured', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_price: '21',
      registration_ln_enabled: 'true',
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({ free: true })
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it('returns { free: true } when registration disabled flag is off', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@getalby.com',
      registration_price: '21',
      registration_ln_enabled: 'false',
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({ free: true })
  })

  it('rejects registration without username', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@getalby.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('rejects registration when username already exists', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@getalby.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
    } as any)

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it('generates invoice via LUD-16 and persists it', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@getalby.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.invoice.create).mockResolvedValue({
      id: 'invoice-1',
      bolt11: 'lnbc210n1test',
      paymentHash: 'c'.repeat(64),
      amountSats: 21,
      expiresAt: new Date('2026-04-15T00:00:00.000Z'),
    } as any)

    // Two fetches: LUD-16 metadata + callback
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/.well-known/lnurlp/')) {
        return {
          ok: true,
          json: async () => ({
            tag: 'payRequest',
            callback: 'https://getalby.com/lnurlp/admin/callback',
            minSendable: 1000,
            maxSendable: 1000000000,
          }),
        } as any
      }
      return {
        ok: true,
        json: async () => ({
          pr: 'lnbc210n1test',
          verify: 'https://getalby.com/lnurlp/admin/verify/xyz',
        }),
      } as any
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe('invoice-1')
    expect(body.bolt11).toBe('lnbc210n1test')
    expect(body.paymentHash).toBe('c'.repeat(64))
    expect(body.amountSats).toBe(21)
    expect(body.verify).toBe('https://getalby.com/lnurlp/admin/verify/xyz')
    expect(body.expiresAt).toBeDefined()

    expect(prismaMock.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bolt11: 'lnbc210n1test',
          paymentHash: 'c'.repeat(64),
          amountSats: 21,
          purpose: 'REGISTRATION',
          status: 'PENDING',
          userId: 'user-1',
          metadata: { username: 'alice' },
        }),
      })
    )
  })

  it('fails with validation error when LUD-16 lookup fails', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@bad-domain.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }) as any)

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it('rejects invalid lightning address format', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'not-an-address',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('mints an invoice with purpose WALLET_ADDRESS for secondary-address flow', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@provider.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.invoice.create).mockResolvedValue({
      id: 'inv-w-1',
      bolt11: 'lnbc210n1test',
      paymentHash: 'c'.repeat(64),
      amountSats: 21,
      expiresAt: new Date('2026-04-22T00:00:00Z'),
    } as any)

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/.well-known/lnurlp/')) {
        return {
          ok: true,
          json: async () => ({
            tag: 'payRequest',
            callback: 'https://provider.com/cb',
            minSendable: 1000,
            maxSendable: 1_000_000_000,
          }),
        } as any
      }
      return {
        ok: true,
        json: async () => ({
          pr: 'lnbc210n1test',
          verify: 'https://provider.com/verify/xyz',
        }),
      } as any
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: {
        purpose: 'wallet-address',
        metadata: { username: 'secondary1' },
      },
    })
    const res = await POST(req)
    await assertResponse(res, 200)

    expect(prismaMock.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: 'WALLET_ADDRESS',
          metadata: { username: 'secondary1' },
        }),
      })
    )
  })

  it('rejects (400) and does not persist when provider omits LUD-21 verify', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      registration_ln_address: 'admin@regressed-provider.com',
      registration_price: '21',
      registration_ln_enabled: 'true',
    })
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/.well-known/lnurlp/')) {
        return {
          ok: true,
          json: async () => ({
            tag: 'payRequest',
            callback: 'https://regressed-provider.com/cb',
            minSendable: 1000,
            maxSendable: 1_000_000_000,
          }),
        } as any
      }
      return {
        ok: true,
        json: async () => ({ pr: 'lnbc210n1test' }), // no verify
      } as any
    })

    const req = createNextRequest('/api/invoices', {
      method: 'POST',
      body: { purpose: 'registration', metadata: { username: 'alice' } },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body: any = await res.json()
    expect(body.error.message).toMatch(/LUD-21/)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })
})
