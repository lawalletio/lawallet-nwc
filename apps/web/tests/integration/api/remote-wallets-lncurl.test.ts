import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createRemoteWalletFixture,
  createUserFixture
} from '@/tests/helpers/fixtures'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 },
    nwcVault: {
      previousSecrets: [],
      secret: 'test-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn()
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

const LNCURL_URI = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`

vi.mock('@/lib/lncurl', () => ({
  createLncurlWallet: vi.fn(async () => ({
    connectionString: LNCURL_URI,
    mode: 'SEND_RECEIVE' as const
  })),
  DEFAULT_LNCURL_SERVER: 'https://lncurl.lol/'
}))

import { POST as createHandler } from '@/app/api/remote-wallets/lncurl/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'
import { createLncurlWallet } from '@/lib/lncurl'

const USER_PUBKEY = 'a'.repeat(64)

function mockAuth(pubkey = USER_PUBKEY) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as never,
    method: 'jwt'
  })
}

function mockUnauthenticated() {
  vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('No auth'))
}

function mockCreatedWallet(
  userId: string,
  overrides: { id?: string; name?: string; isDefault?: boolean } = {}
) {
  const created = createRemoteWalletFixture({
    id: overrides.id ?? 'lncurl-1',
    userId,
    name: overrides.name ?? 'LNCurl wallet',
    isDefault: overrides.isDefault ?? false
  })
  vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(created as never)
  vi.mocked(prismaMock.remoteWallet.findUniqueOrThrow).mockResolvedValue(
    created as never
  )
  return created
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)
})

describe('POST /api/remote-wallets/lncurl', () => {
  it('returns 400 when LNCurl is disabled', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'false' })

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )

    expect(res.status).toBe(400)
    expect(createLncurlWallet).not.toHaveBeenCalled()
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the setting is simply absent', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({})

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )

    expect(res.status).toBe(400)
    expect(createLncurlWallet).not.toHaveBeenCalled()
  })

  it('provisions a wallet and returns 201 with the DTO shape (no config)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    mockCreatedWallet(user.id)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )
    const body = (await assertResponse(res, 201)) as Record<string, unknown>

    expect(body).toMatchObject({
      id: 'lncurl-1',
      name: 'LNCurl wallet',
      type: 'NWC',
      status: 'ACTIVE',
      isDefault: false
    })
    expect(body).toHaveProperty('createdAt')
    expect(body).toHaveProperty('updatedAt')
    // Secrets must never leak.
    expect(body).not.toHaveProperty('config')
    expect(body).not.toHaveProperty('userId')
  })

  it('passes the optional name and serverUrl through mint + persist', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_enabled: 'true',
      lncurl_server_url: 'https://my.lncurl.example'
    })
    mockCreatedWallet(user.id, { name: 'Pocket' })

    await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { name: 'Pocket' }
      })
    )

    expect(createLncurlWallet).toHaveBeenCalledWith('https://my.lncurl.example')
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.id,
          name: 'Pocket'
        })
      })
    )
  })

  it('binds the primary address to the new wallet when one exists', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    mockCreatedWallet(user.id, { id: 'lncurl-1' })
    vi.mocked(prismaMock.lightningAddress.findFirst)
      .mockResolvedValueOnce({ username: 'alice' } as never)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'lncurl-1'
      } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { isDefault: true }
      })
    )
    const body = (await assertResponse(res, 201)) as { isDefault: boolean }

    expect(body.isDefault).toBe(true)
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: 'lncurl-1'
      }
    })
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('does not bind the primary address unless requested', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    mockCreatedWallet(user.id, { id: 'lncurl-2' })

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )
    const body = (await assertResponse(res, 201)) as { isDefault: boolean }

    expect(body.isDefault).toBe(false)
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })

  it('creates the wallet without a primary flag when requested but the user has no primary address', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(
      null as never
    )
    mockCreatedWallet(user.id, { id: 'lncurl-2' })

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { isDefault: true }
      })
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
    vi.mocked(createLncurlWallet).mockRejectedValueOnce(
      new Error('LNCurl unreachable')
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )

    expect(res.status).toBe(503)
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })

  it('returns 409 when the (userId, name) unique index fires', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.remoteWallet.create).mockRejectedValue(
      Object.assign(new Error('unique violation'), { code: 'P2002' })
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { name: 'Duplicate' }
      })
    )

    expect(res.status).toBe(409)
  })

  it('rethrows non-P2002 DB errors as a 500, not a 503', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    vi.mocked(prismaMock.remoteWallet.create).mockRejectedValue(
      new Error('connection reset')
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )

    expect(res.status).toBe(500)
  })

  it('does not map a bind failure after a successful mint to 503', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(getSettings).mockResolvedValue({ lncurl_enabled: 'true' })
    mockCreatedWallet(user.id, { id: 'lncurl-1' })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      username: 'alice'
    } as never)
    vi.mocked(prismaMock.lightningAddress.update).mockRejectedValue(
      new Error('connection reset')
    )

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: { isDefault: true }
      })
    )

    expect(createLncurlWallet).toHaveBeenCalled()
    expect(prismaMock.remoteWallet.create).toHaveBeenCalled()
    expect(res.status).toBe(500)
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated()

    const res = await createHandler(
      createNextRequest('/api/remote-wallets/lncurl', {
        method: 'POST',
        body: {}
      })
    )

    expect(res.status).toBe(401)
    expect(createLncurlWallet).not.toHaveBeenCalled()
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })
})
