import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'
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

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

import { PUT } from '@/app/api/users/[userId]/nwc/route'
import { validateNip98 } from '@/lib/nip98'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('PUT /api/users/[userId]/nwc', () => {
  it('updates NWC URI for own user', async () => {
    const user = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({
      id: user.id,
      nwc: 'nostr+walletconnect://test',
    } as any)

    const req = createNextRequest(`/api/users/${user.id}/nwc`, {
      method: 'PUT',
      body: { nwcUri: 'nostr+walletconnect://test' },
    })
    const res = await PUT(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      userId: user.id,
      nwcUri: 'nostr+walletconnect://test',
      updated: true,
    })
  })

  it('rejects unauthorized user', async () => {
    const otherUser = createUserFixture({ pubkey: 'b'.repeat(64) })
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(otherUser as any)

    const req = createNextRequest(`/api/users/${otherUser.id}/nwc`, {
      method: 'PUT',
      body: { nwcUri: 'nostr+walletconnect://test' },
    })
    const res = await PUT(req, createParamsPromise({ userId: otherUser.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/nwc', {
      method: 'PUT',
      body: { nwcUri: 'nostr+walletconnect://test' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects missing nwcUri', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })

    const req = createNextRequest('/api/users/some-id/nwc', {
      method: 'PUT',
      body: {},
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/users/some-id/nwc', {
      method: 'PUT',
      body: { nwcUri: 'nostr+walletconnect://test' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(401)
  })
})
