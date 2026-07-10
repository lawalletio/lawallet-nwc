import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createRemoteWalletFixture, createUserFixture } from '@/tests/helpers/fixtures'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
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

vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  createLncurlRemoteWallet: vi.fn(),
}))

import { POST as createHandler } from '@/app/api/remote-wallets/lncurl/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'

const USER_PUBKEY = 'a'.repeat(64)

function mockAuth(pubkey = USER_PUBKEY) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as never,
    method: 'jwt',
  })
}

function mockUnauthenticated() {
  vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('No auth'))
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('POST /api/remote-wallets/lncurl', () => {
  it('returns 400 when LNCurl is disabled', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'false' })

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )

    expect(res.status).toBe(400)
    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })

  it('returns 400 when the setting is simply absent', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({})

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )

    expect(res.status).toBe(400)
  })

  it('provisions a wallet and returns 201 with the DTO shape (no config)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })

    const created = createRemoteWalletFixture({
      id: 'lncurl-1',
      userId: user.id,
      name: 'LNCurl wallet',
      isDefault: false,
    })
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(created as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )
    const body = (await assertResponse(res, 201)) as Record<string, unknown>

    expect(body).toMatchObject({
      id: 'lncurl-1',
      name: 'LNCurl wallet',
      type: 'NWC',
      status: 'ACTIVE',
      isDefault: false,
    })
    expect(body).toHaveProperty('createdAt')
    expect(body).toHaveProperty('updatedAt')
    // Secrets must never leak.
    expect(body).not.toHaveProperty('config')
    expect(body).not.toHaveProperty('userId')
  })

  it('passes the optional name and serverUrl to the LNCurl wallet helper', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_enabled: 'true',
      lncurl_server_url: 'https://my.lncurl.example',
    })
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id, isDefault: false }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { name: 'Pocket' },
      }),
    )

    expect(createLncurlRemoteWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        name: 'Pocket',
        revokePrevious: false,
        serverUrl: 'https://my.lncurl.example',
      }),
    )
  })

  it('binds the primary address to the new wallet when one exists', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ id: 'lncurl-1', userId: user.id, isDefault: false }) as never,
    )
    vi.mocked(prismaMock.lightningAddress.findFirst)
      .mockResolvedValueOnce({ username: 'alice' } as never)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'lncurl-1',
      } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { isDefault: true },
      }),
    )
    const body = (await assertResponse(res, 201)) as { isDefault: boolean }

    expect(body.isDefault).toBe(true)
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: 'lncurl-1',
      },
    })
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
  })

  it('does not bind the primary address unless requested', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ id: 'lncurl-2', userId: user.id, isDefault: false }) as never,
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )
    const body = (await assertResponse(res, 201)) as { isDefault: boolean }

    expect(body.isDefault).toBe(false)
    expect(prismaMock.lightningAddress.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })

  it('creates the wallet without a primary flag when requested but the user has no primary address', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null as never)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ id: 'lncurl-2', userId: user.id, isDefault: false }) as never,
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { isDefault: true },
      }),
    )
    const body = (await assertResponse(res, 201)) as { isDefault: boolean }

    expect(body.isDefault).toBe(false)
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })

  it('returns 503 when provisioning fails (provider/network error)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(createLncurlRemoteWallet).mockRejectedValue(new Error('LNCurl unreachable'))

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )

    expect(res.status).toBe(503)
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated()

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )

    expect(res.status).toBe(401)
    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })
})
