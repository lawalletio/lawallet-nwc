import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture, createLightningAddressFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthenticationError } from '@/types/server/errors'

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

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { PUT } from '@/app/api/users/[userId]/lightning-address/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

function mockAuth(pubkey: string = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'nip98',
  })
}

function mockAuthReject() {
  vi.mocked(authenticate).mockRejectedValue(
    new AuthenticationError('no auth')
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('PUT /api/users/[userId]/lightning-address', () => {
  it('creates new lightning address for user', async () => {
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [] })
    mockAuth()
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
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [oldAddress] })
    mockAuth()
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
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [address] })
    mockAuth()
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
    const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [] })
    mockAuth()
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
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(otherUser as any)

    const req = createNextRequest(`/api/users/${otherUser.id}/lightning-address`, {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: otherUser.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/lightning-address', {
      method: 'PUT',
      body: { username: 'alice' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects invalid username format', async () => {
    mockAuth()

    const req = createNextRequest('/api/users/some-id/lightning-address', {
      method: 'PUT',
      body: { username: 'INVALID USERNAME!' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })

  it('rejects empty username', async () => {
    mockAuth()

    const req = createNextRequest('/api/users/some-id/lightning-address', {
      method: 'PUT',
      body: { username: '' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })

  describe('paid registration enforcement', () => {
    it('rejects first-time registration with 402 when paid mode is on and actor is USER', async () => {
      const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [] })
      mockAuth()
      vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
      vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({
        domain: 'test.com',
        registration_ln_enabled: 'true',
        registration_ln_address: 'admin@provider.com',
        registration_admin_bypass: 'true',
      })

      const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
        method: 'PUT',
        body: { username: 'alice' },
      })
      const res = await PUT(req, createParamsPromise({ userId: user.id }))

      expect(res.status).toBe(402)
      expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
    })

    it('lets ADMIN bypass payment when registration_admin_bypass is true', async () => {
      const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [] })
      vi.mocked(authenticate).mockResolvedValue({
        pubkey: mockPubkey,
        role: 'ADMIN' as any,
        method: 'jwt',
      })
      vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
      vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({
        domain: 'test.com',
        registration_ln_enabled: 'true',
        registration_ln_address: 'admin@provider.com',
        registration_admin_bypass: 'true',
      })
      vi.mocked(prismaMock.lightningAddress.create).mockResolvedValue({} as any)

      const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
        method: 'PUT',
        body: { username: 'alice' },
      })
      const res = await PUT(req, createParamsPromise({ userId: user.id }))

      expect(res.status).toBe(200)
      expect(prismaMock.lightningAddress.create).toHaveBeenCalled()
    })

    it('rejects ADMIN when registration_admin_bypass is false', async () => {
      const user = createUserFixture({ pubkey: mockPubkey, lightningAddresses: [] })
      vi.mocked(authenticate).mockResolvedValue({
        pubkey: mockPubkey,
        role: 'ADMIN' as any,
        method: 'jwt',
      })
      vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
      vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({
        domain: 'test.com',
        registration_ln_enabled: 'true',
        registration_ln_address: 'admin@provider.com',
        registration_admin_bypass: 'false',
      })

      const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
        method: 'PUT',
        body: { username: 'alice' },
      })
      const res = await PUT(req, createParamsPromise({ userId: user.id }))

      expect(res.status).toBe(402)
    })

    it('rejects swap of an existing primary address when paid mode is on and actor is USER', async () => {
      // A swap from `oldalice` → `newalice` is still a new-username
      // registration: in paid mode, the user must pay via /api/invoices.
      // The no-op branch (same username) short-circuits earlier and is
      // covered by the "returns existing when username unchanged" test.
      const oldAddress = createLightningAddressFixture({ username: 'oldalice' })
      const user = createUserFixture({
        pubkey: mockPubkey,
        lightningAddresses: [oldAddress],
      })
      mockAuth()
      vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
      vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({
        domain: 'test.com',
        registration_ln_enabled: 'true',
        registration_ln_address: 'admin@provider.com',
        registration_admin_bypass: 'true',
      })

      const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
        method: 'PUT',
        body: { username: 'newalice' },
      })
      const res = await PUT(req, createParamsPromise({ userId: user.id }))

      expect(res.status).toBe(402)
      expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
    })

    it('allows USER swap for free when paid mode is off', async () => {
      const oldAddress = createLightningAddressFixture({ username: 'oldalice' })
      const user = createUserFixture({
        pubkey: mockPubkey,
        lightningAddresses: [oldAddress],
      })
      mockAuth()
      vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
      vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({
        domain: 'test.com',
        registration_ln_enabled: 'false',
      })
      vi.mocked(prismaMock.lightningAddress.create).mockResolvedValue({} as any)
      vi.mocked(prismaMock.lightningAddress.delete).mockResolvedValue({} as any)

      const req = createNextRequest(`/api/users/${user.id}/lightning-address`, {
        method: 'PUT',
        body: { username: 'newalice' },
      })
      const res = await PUT(req, createParamsPromise({ userId: user.id }))

      expect(res.status).toBe(200)
    })
  })
})
