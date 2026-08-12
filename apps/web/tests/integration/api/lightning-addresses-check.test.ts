import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

const rateLimitMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: rateLimitMock,
  RateLimitPresets: { public: {} }
}))

import { GET } from '@/app/api/lightning-addresses/check/route'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  rateLimitMock.mockResolvedValue(undefined)
})

describe('GET /api/lightning-addresses/check', () => {
  it('applies the public rate limit before touching the DB', async () => {
    const { TooManyRequestsError } = await import('@/types/server/errors')
    rateLimitMock.mockRejectedValue(new TooManyRequestsError())

    const res = await GET(
      createNextRequest('/api/lightning-addresses/check?username=alice')
    )

    expect(res.status).toBe(429)
    expect(rateLimitMock).toHaveBeenCalled()
    expect(prismaMock.lightningAddress.findFirst).not.toHaveBeenCalled()
  })

  it('reports an available username', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)

    const res = await GET(
      createNextRequest('/api/lightning-addresses/check?username=alice')
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({ available: true, username: 'alice' })
  })

  it('reports a taken username', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      username: 'alice'
    } as any)

    const res = await GET(
      createNextRequest('/api/lightning-addresses/check?username=Alice')
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({ available: false, username: 'alice' })
  })

  it('rejects a missing username with 400', async () => {
    const res = await GET(createNextRequest('/api/lightning-addresses/check'))

    expect(res.status).toBe(400)
  })

  it('rejects an invalid username with 400', async () => {
    const res = await GET(
      createNextRequest('/api/lightning-addresses/check?username=not_valid!')
    )

    expect(res.status).toBe(400)
    expect(prismaMock.lightningAddress.findFirst).not.toHaveBeenCalled()
  })
})
