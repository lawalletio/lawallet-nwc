import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createNtag424Fixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({ checkRequestLimits: vi.fn() }))
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))

import { POST } from '@/app/api/cards/[id]/emulate-tap/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticateWithPermission).mockResolvedValue({ pubkey: 'x' } as any)
})

describe('POST /api/cards/[id]/emulate-tap', () => {
  it('returns the signed p/c for the next counter, without any keys', async () => {
    const ntag424 = createNtag424Fixture({ ctr: 7 })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ ntag424 } as any)

    const req = createNextRequest('/api/cards/card-1/emulate-tap', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.ctr).toBe(8) // server counter + 1
    expect(body.p).toMatch(/^[A-F0-9]{32}$/)
    expect(body.c).toMatch(/^[A-F0-9]{16}$/)
    // Keys never appear in the response.
    expect(body.k0).toBeUndefined()
    expect(body.k1).toBeUndefined()
  })

  it('returns 404 for a missing card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/none/emulate-tap', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'none' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when the card has no NTAG424', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ ntag424: null } as any)

    const req = createNextRequest('/api/cards/card-1/emulate-tap', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(400)
  })
})
