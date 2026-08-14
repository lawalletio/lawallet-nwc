import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createLightningAddressFixture } from '@/tests/helpers/fixtures'

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

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn().mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'ADMIN',
    method: 'jwt'
  }),
  authenticateWithRole: vi.fn().mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'ADMIN',
    method: 'jwt'
  }),
  authenticateWithPermission: vi
    .fn()
    .mockResolvedValue({ pubkey: 'a'.repeat(64), role: 'ADMIN', method: 'jwt' })
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn()
}))

vi.mock('@/lib/auth/account', () => ({
  resolveAccountByPubkey: vi.fn()
}))

vi.mock('@/lib/wallet/create-address', () => ({
  createLightningAddressForUser: vi.fn()
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/mocks/lightning-address', () => ({
  mockLightningAddressData: [
    {
      username: 'alice',
      nwc: 'nostr+walletconnect://test?relay=wss%3A%2F%2Frelay.test.com&secret=abc'
    },
    {
      username: 'bob',
      nwc: 'nostr+walletconnect://test?relay=wss%3A%2F%2Frelay.other.com&secret=def'
    },
    {
      username: 'charlie'
    }
  ]
}))

import {
  GET as ListGet,
  POST as ProvisionPost
} from '@/app/api/lightning-addresses/route'
import { GET as CountsGet } from '@/app/api/lightning-addresses/counts/route'
import { GET as RelaysGet } from '@/app/api/lightning-addresses/relays/route'
import { validateAdminAuth } from '@/lib/admin-auth'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { createLightningAddressForUser } from '@/lib/wallet/create-address'
import { AuthorizationError, ConflictError } from '@/types/server/errors'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/lightning-addresses', () => {
  it('returns all lightning addresses for authorized user', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      {
        username: 'alice',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: null,
        isPrimary: true,
        remoteWallet: null,
        user: {
          pubkey: 'a'.repeat(64),
          remoteWallets: [
            {
              type: 'NWC',
              config: {
                connectionString: 'nostr+walletconnect://test',
                mode: 'SEND_RECEIVE'
              },
              status: 'ACTIVE'
            }
          ]
        }
      }
    ] as any)

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ username: 'alice', pubkey: 'a'.repeat(64) })
  })

  it('returns empty array when no addresses', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects unauthorized user', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValueOnce(
      new Error('unauthorized')
    )

    const req = createNextRequest('/api/lightning-addresses')
    const res = await ListGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/lightning-addresses/counts', () => {
  it('returns counts for authorized user', async () => {
    vi.mocked(prismaMock.lightningAddress.count)
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7) // withNWC
      .mockResolvedValueOnce(3) // withoutNWC

    const req = createNextRequest('/api/lightning-addresses/counts')
    const res = await CountsGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ total: 10, withNWC: 7, withoutNWC: 3 })
  })

  it('returns zero counts', async () => {
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)

    const req = createNextRequest('/api/lightning-addresses/counts')
    const res = await CountsGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ total: 0, withNWC: 0, withoutNWC: 0 })
  })

  it('rejects unauthorized user', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValueOnce(
      new Error('unauthorized')
    )

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

describe('POST /api/lightning-addresses (operator provisioning)', () => {
  const ADMIN = 'a'.repeat(64)
  const TARGET = 'b'.repeat(64)

  const provisioned = (overrides: Record<string, unknown> = {}) => ({
    username: 'reserved',
    mode: 'IDLE',
    redirect: null,
    remoteWalletId: null,
    remoteWalletName: null,
    isPrimary: true,
    nwcMode: 'NONE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })

  const post = (body: unknown) =>
    ProvisionPost(
      createNextRequest('/api/lightning-addresses', { method: 'POST', body })
    )

  beforeEach(() => {
    vi.mocked(createLightningAddressForUser).mockResolvedValue(
      provisioned() as any
    )
  })

  it('creates the account when the pubkey is unknown to this instance', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    vi.mocked(createNewUser).mockResolvedValue({ id: 'user-new' } as any)

    const res = await post({ username: 'reserved', pubkey: TARGET })
    const body = await assertResponse(res, 201)

    expect(createNewUser).toHaveBeenCalledTimes(1)
    expect(createNewUser).toHaveBeenCalledWith(TARGET)
    expect(createLightningAddressForUser).toHaveBeenCalledWith({
      userId: 'user-new',
      username: 'reserved',
      provisionedBy: ADMIN
    })
    expect(body.username).toBe('reserved')
    expect(body.pubkey).toBe(TARGET)
  })

  it('reuses an existing account and echoes its primary pubkey', async () => {
    // Provisioning against a SECONDARY identity still belongs to the one
    // account, so the response reports the primary.
    vi.mocked(resolveAccountByPubkey).mockResolvedValue({
      id: 'user-1',
      primaryPubkey: 'c'.repeat(64),
      authPubkey: TARGET,
      role: 'USER'
    } as any)

    const res = await post({ username: 'reserved', pubkey: TARGET })
    const body = await assertResponse(res, 201)

    expect(createNewUser).not.toHaveBeenCalled()
    expect(createLightningAddressForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    )
    expect(body.pubkey).toBe('c'.repeat(64))
  })

  it('still provisions when self-service registration is disabled', async () => {
    // The whole point of the endpoint: the operator acts out-of-band, so the
    // registration guard must not be consulted at all.
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    vi.mocked(createNewUser).mockResolvedValue({ id: 'user-new' } as any)

    const res = await post({ username: 'reserved', pubkey: TARGET })
    await assertResponse(res, 201)
  })

  it('rejects callers without addresses:write', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValueOnce(
      new AuthorizationError('Insufficient permissions')
    )

    const res = await post({ username: 'reserved', pubkey: TARGET })
    await assertResponse(res, 403)
    expect(createNewUser).not.toHaveBeenCalled()
    expect(createLightningAddressForUser).not.toHaveBeenCalled()
  })

  it('surfaces a taken username as 409', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue({
      id: 'user-1',
      primaryPubkey: TARGET,
      authPubkey: TARGET,
      role: 'USER'
    } as any)
    vi.mocked(createLightningAddressForUser).mockRejectedValueOnce(
      new ConflictError('Username is already taken')
    )

    const res = await post({ username: 'taken', pubkey: TARGET })
    await assertResponse(res, 409)
  })

  it('rejects a malformed pubkey before touching any account', async () => {
    const res = await post({ username: 'reserved', pubkey: 'npub1nothex' })
    await assertResponse(res, 400)
    expect(resolveAccountByPubkey).not.toHaveBeenCalled()
    expect(createNewUser).not.toHaveBeenCalled()
  })
})
