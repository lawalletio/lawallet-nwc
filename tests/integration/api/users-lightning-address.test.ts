import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture, createLightningAddressFixture } from '@/tests/helpers/fixtures'
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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { PUT } from '@/app/api/users/[userId]/lightning-address/route'
import { validateNip98 } from '@/lib/nip98'
import { createNip98Result } from '@/tests/helpers/auth-helpers'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('PUT /api/users/[userId]/lightning-address', () => {
  it('creates new lightning address for user', async () => {
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddress: null })
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.lightningAddress.create).mockResolvedValue({} as any)

    const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({
      lightningAddress: 'alice@test.com',
      username: 'alice',
      domain: 'test.com',
      replaced: null,
    })
  })

  it('replaces existing lightning address', async () => {
    const oldAddress = createLightningAddressFixture({ username: 'oldalice' })
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddress: oldAddress })
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.lightningAddress.create).mockResolvedValue({} as any)
    vi.mocked(prismaMock.lightningAddress.delete).mockResolvedValue({} as any)

    const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'newalice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({
      lightningAddress: 'newalice@test.com',
      replaced: 'oldalice@test.com',
    })
    expect(prismaMock.lightningAddress.delete).toHaveBeenCalled()
  })

  it('returns existing when username unchanged', async () => {
    const address = createLightningAddressFixture({ username: 'alice' })
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddress: address })
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({
      lightningAddress: 'alice@test.com',
      replaced: null,
    })
    expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
  })

  it('rejects duplicate username taken by another user', async () => {
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddress: null })
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      userId: 'other-user-id',
    } as any)

    const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: user.id }))

    expect(res.status).toBe(409)
  })

  it('rejects unauthorized user', async () => {
    const otherUser = createUserFixture({ pubkey: 'b'.repeat(64) })
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(otherUser as any)

    const req = createNextRequest(`/api/users/${otherUser.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: otherUser.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/lightning-address', {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects invalid username format', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))

    const req = createNextRequest('/api/users/some-id/lightning-address', {
      method: 'PUT',
      body: { username: 'INVALID USERNAME!' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })

  it('rejects empty username', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))

    const req = createNextRequest('/api/users/some-id/lightning-address', {
      method: 'PUT',
      body: { username: '' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })
})
