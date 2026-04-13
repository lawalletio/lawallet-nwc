import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createLightningAddressFixture } from '@/tests/helpers/fixtures'

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

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn(),
}))

vi.mock('@/mocks/lightning-address', () => ({
  mockLightningAddressData: [
    {
      username: 'alice',
      nwc: 'nostr+walletconnect://test?relay=wss%3A%2F%2Frelay.test.com&secret=abc',
    },
    {
      username: 'bob',
      nwc: 'nostr+walletconnect://test?relay=wss%3A%2F%2Frelay.other.com&secret=def',
    },
    {
      username: 'charlie',
    },
  ],
}))

import { GET as ListGet } from '@/app/api/lightning-addresses/route'
import { GET as CountsGet } from '@/app/api/lightning-addresses/counts/route'
import { GET as RelaysGet } from '@/app/api/lightning-addresses/relays/route'
import { validateAdminAuth } from '@/lib/admin-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/lightning-addresses', () => {
  it('returns all lightning addresses for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      {
        username: 'alice',
        createdAt: new Date('2024-01-01'),
        user: { pubkey: 'a'.repeat(64), nwc: 'nostr+walletconnect://test' },
      },
    ] as any)

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ username: 'alice', pubkey: 'a'.repeat(64) })
  })

  it('returns empty array when no addresses', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/lightning-addresses/counts', () => {
  it('returns counts for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.lightningAddress.count)
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7)  // withNWC
      .mockResolvedValueOnce(3)  // withoutNWC

    const req = createNextRequest('/api/lightning-addresses/counts')
    const res = await CountsGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ total: 10, withNWC: 7, withoutNWC: 3 })
  })

  it('returns zero counts', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)

    const req = createNextRequest('/api/lightning-addresses/counts')
    const res = await CountsGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ total: 0, withNWC: 0, withoutNWC: 0 })
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/lightning-addresses/counts')
    const res = await CountsGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/lightning-addresses/relays', () => {
  it('returns unique relay URLs for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')

    const req = createNextRequest('/api/lightning-addresses/relays')
    const res = await RelaysGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toContain('wss://relay.test.com')
    expect(body).toContain('wss://relay.other.com')
    expect(body).toHaveLength(2)
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/lightning-addresses/relays')
    const res = await RelaysGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
