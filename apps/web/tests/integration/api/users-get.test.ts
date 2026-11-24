import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    maintenance: { enabled: false },
    isDevelopment: false,
    isTest: true
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

// Keep the real scope-aware permission check; only the credential is faked.
vi.mock('@/lib/auth/unified-auth', async importActual => ({
  ...(await importActual<typeof import('@/lib/auth/unified-auth')>()),
  authenticate: vi.fn()
}))

vi.mock('@/lib/auth/account', () => ({
  resolveAccountByPubkey: vi.fn()
}))

vi.mock('@/lib/wallet/primary-wallet', () => ({
  getPrimaryRemoteWalletForUser: vi.fn(async () => null)
}))

import { GET } from '@/app/api/users/[userId]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { Permission, Role } from '@/lib/auth/permissions'

const OWNER_PUBKEY = 'a'.repeat(64)
const USER_ROW = {
  id: 'user-1',
  pubkey: OWNER_PUBKEY,
  role: 'USER',
  relays: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lightningAddresses: []
}

function callGet() {
  return GET(createNextRequest('/api/users/user-1'), {
    params: createParamsPromise({ userId: 'user-1' })
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue(USER_ROW as any)
  vi.mocked(prismaMock.invoice.count).mockResolvedValue(0)
  vi.mocked(prismaMock.invoice.aggregate).mockResolvedValue({
    _sum: { amountSats: null },
    _count: 0
  } as any)
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
})

describe('GET /api/users/[userId]', () => {
  it('lets a session read its own profile without USERS_READ', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: OWNER_PUBKEY,
      role: Role.USER,
      method: 'jwt'
    })

    const res = await callGet()

    expect(res.status).toBe(200)
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), {
      allowDeviceToken: true
    })
  })

  // A device token is admitted only through its delegated scopes: holding
  // the owner's pubkey must not make it "self".
  it("refuses a device token for the owner's own profile without users:read", async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: OWNER_PUBKEY,
      role: Role.USER,
      method: 'jwt',
      scopes: [Permission.CARDS_WRITE],
      deviceToken: true
    })

    const res = await callGet()

    expect(res.status).toBe(403)
  })

  it('lets a device token delegated users:read read the profile', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: OWNER_PUBKEY,
      role: Role.USER,
      method: 'jwt',
      scopes: [Permission.USERS_READ],
      deviceToken: true
    })

    const res = await callGet()

    expect(res.status).toBe(200)
  })
})
