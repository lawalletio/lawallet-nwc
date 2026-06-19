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
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null as never)

    const created = createRemoteWalletFixture({
      id: 'lncurl-1',
      userId: user.id,
      name: 'LNCurl wallet',
      isDefault: true,
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
      isDefault: true,
    })
    expect(body).toHaveProperty('createdAt')
    expect(body).toHaveProperty('updatedAt')
    // Secrets must never leak.
    expect(body).not.toHaveProperty('config')
    expect(body).not.toHaveProperty('userId')
  })

  it('passes the caller current default as previousWalletId with revokePrevious:false', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_enabled: 'true',
      lncurl_server_url: 'https://my.lncurl.example',
    })
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({ id: 'old-default' } as never)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id, isDefault: true }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )

    expect(createLncurlRemoteWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        previousWalletId: 'old-default',
        revokePrevious: false,
        serverUrl: 'https://my.lncurl.example',
      }),
    )
  })

  it('onboarding (no current default) binds the primary address + unbound cards to the new wallet', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    // No existing default → this is the user's first wallet.
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null as never)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ id: 'lncurl-1', userId: user.id, isDefault: true }) as never,
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )
    expect(res.status).toBe(201)

    // Primary LA (non-ALIAS) is bound CUSTOM_NWC to the fresh wallet…
    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, isPrimary: true, mode: { not: 'ALIAS' } },
      data: { mode: 'CUSTOM_NWC', remoteWalletId: 'lncurl-1' },
    })
    // …and unbound cards too.
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, remoteWalletId: null },
      data: { remoteWalletId: 'lncurl-1' },
    })
  })

  it('does NOT run the onboarding bind when the user already has a default wallet', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({ id: 'old-default' } as never)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(
      createRemoteWalletFixture({ id: 'lncurl-2', userId: user.id, isDefault: true }) as never,
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', { method: 'POST', body: {} }),
    )
    expect(res.status).toBe(201)

    // Re-binding of an existing default's resources is the orchestrator's job
    // (mocked here); the route's onboarding-only bind must not fire.
    expect(prismaMock.lightningAddress.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
  })

  it('returns 503 when provisioning fails (provider/network error)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null as never)
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
