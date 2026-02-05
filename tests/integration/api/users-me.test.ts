import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'

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

vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { GET } from '@/app/api/users/me/route'
import { validateNip98 } from '@/lib/nip98'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users/me', () => {
  it('returns existing user data', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: { username: 'alice' },
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      userId: user.id,
      lightningAddress: 'alice@test.com',
    })
  })

  it('creates new user if not existing', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    const newUser = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: null,
      albySubAccount: null,
    })
    vi.mocked(createNewUser).mockResolvedValue(newUser as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(mockPubkey)
    expect(body).toMatchObject({ userId: newUser.id })
  })

  it('returns null lightning address when user has none', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: null,
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.lightningAddress).toBeNull()
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns alby sub account data when present', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: mockPubkey })
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: null,
      albySubAccount: {
        appId: 'app123',
        nwcUri: 'nostr+walletconnect://test',
        username: 'alice',
      },
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.albySubAccount).toEqual({
      appId: 'app123',
      nwcUri: 'nostr+walletconnect://test',
      username: 'alice',
    })
    expect(body.nwcString).toBe('nostr+walletconnect://test')
  })
})
