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

vi.mock('@getalby/sdk', () => ({
  LN: vi.fn().mockImplementation(() => ({
    requestPayment: vi.fn().mockResolvedValue({
      invoice: { paymentRequest: 'lnbc100n1test' },
    }),
  })),
  SATS: vi.fn((v: number) => v),
}))

import { GET as Lud16Get } from '@/app/api/lud16/[username]/route'
import { GET as Lud16CbGet } from '@/app/api/lud16/[username]/cb/route'
import { getSettings } from '@/lib/settings'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/lud16/[username]', () => {
  it('returns LUD-06 pay response for valid username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test' },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://test.com' })

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
      user: { id: 'user-1', nwc: null },
    } as any)

    const req = createNextRequest('/api/lud16/alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
  })

  it('handles case-insensitive username lookup', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test' },
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://test.com' })

    const req = createNextRequest('/api/lud16/Alice')
    const res = await Lud16Get(req, createParamsPromise({ username: 'Alice' }))

    expect(res.status).toBe(200)
    expect(prismaMock.lightningAddress.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'alice' } })
    )
  })
})

describe('GET /api/lud16/[username]/cb', () => {
  it('creates invoice and returns payment request', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { id: 'user-1', nwc: 'nostr+walletconnect://test' },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))
    const body: any = await assertResponse(res, 200)

    expect(body.pr).toBe('lnbc100n1test')
    expect(body.routes).toEqual([])
  })

  it('returns 404 for nonexistent username', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/lud16/nonexistent/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects missing amount parameter', async () => {
    const req = createNextRequest('/api/lud16/alice/cb')
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(400)
  })

  it('returns 404 when user has no NWC', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { id: 'user-1', nwc: null },
    } as any)

    const req = createNextRequest('/api/lud16/alice/cb', {
      searchParams: { amount: '10000' },
    })
    const res = await Lud16CbGet(req, createParamsPromise({ username: 'alice' }))

    expect(res.status).toBe(404)
  })
})
