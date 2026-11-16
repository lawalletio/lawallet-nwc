import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  installFakeOAuthStore,
  type FakeOAuthStore
} from '@/tests/unit/lib/oauth/fake-oauth-store'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

vi.mock('@/lib/activity-log', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/activity-log')>()),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

import { GET } from '@/app/api/oauth/grants/route'
import { DELETE, PATCH } from '@/app/api/oauth/grants/[id]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

const PUBKEY = 'a'.repeat(64)
const HOUR = 60 * 60 * 1000
let store: FakeOAuthStore

function grantRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clientId: 'client_1',
    userId: 'user_1',
    scopes: ['read', 'write'],
    spendLimitSats: null,
    allWallets: true,
    walletIds: [],
    codeUsedAt: new Date(),
    refreshExpiresAt: new Date(Date.now() + HOUR),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides
  }
}

function signIn(overrides: Record<string, unknown> = {}) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as never,
    method: 'jwt',
    ...overrides
  })
}

const list = () => GET(createNextRequest('/api/oauth/grants'))
const update = (id: string, body: Record<string, unknown>) =>
  PATCH(
    createNextRequest(`/api/oauth/grants/${id}`, { method: 'PATCH', body }),
    createParamsPromise({ id })
  )

/** The caller's live wallets, as `prisma.remoteWallet.findMany` sees them. */
function ownWallets(...wallets: { id: string; name: string }[]) {
  vi.mocked(prismaMock.remoteWallet.findMany).mockImplementation((async ({
    where
  }: {
    where: { id: { in: string[] } }
  }) => wallets.filter(w => where.id.in.includes(w.id))) as never)
}

const remove = (id: string) =>
  DELETE(
    createNextRequest(`/api/oauth/grants/${id}`, { method: 'DELETE' }),
    createParamsPromise({ id })
  )

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  store = installFakeOAuthStore()
  store.clients.push(
    { id: 'client_1', name: 'Claude', redirectUris: [], createdAt: new Date() },
    { id: 'client_2', name: 'Cursor', redirectUris: [], createdAt: new Date() }
  )
  signIn()
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: 'user_1', pubkey: PUBKEY, role: 'USER' }
  } as never)
})

describe('GET /api/oauth/grants', () => {
  it("lists the caller's working grants, newest first", async () => {
    const lastUsedAt = new Date('2026-09-01T10:00:00Z')
    store.grants.push(
      grantRow('older', { createdAt: new Date('2026-09-01T00:00:00Z') }),
      grantRow('newer', {
        clientId: 'client_2',
        scopes: ['read', 'spend'],
        spendLimitSats: 5000,
        lastUsedAt,
        createdAt: new Date('2026-09-02T00:00:00Z')
      }),
      grantRow('pending', { codeUsedAt: null, refreshExpiresAt: null }),
      grantRow('revoked', { revokedAt: new Date() }),
      grantRow('expired', { refreshExpiresAt: new Date(Date.now() - 1) }),
      grantRow('someone_else', { userId: 'user_2' })
    )

    const res = await list()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      grants: [
        {
          id: 'newer',
          clientName: 'Cursor',
          scopes: ['read', 'spend'],
          spendLimitSats: 5000,
          wallets: null,
          createdAt: '2026-09-02T00:00:00.000Z',
          lastUsedAt: lastUsedAt.toISOString()
        },
        {
          id: 'older',
          clientName: 'Claude',
          scopes: ['read', 'write'],
          spendLimitSats: null,
          wallets: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          lastUsedAt: null
        }
      ]
    })
  })

  it('names the wallets of a restricted grant, dropping removed ones', async () => {
    ownWallets({ id: 'w1', name: 'Spending' })
    store.grants.push(
      grantRow('g1', { allWallets: false, walletIds: ['w1', 'gone'] })
    )

    const [grant] = (await (await list()).json()).grants
    expect(grant.wallets).toEqual([{ id: 'w1', name: 'Spending' }])
    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user_1' })
      })
    )
  })

  it('is empty for a pubkey without an account', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    store.grants.push(grantRow('g'))
    expect(await (await list()).json()).toEqual({ grants: [] })
  })

  it('refuses device tokens and anonymous callers', async () => {
    signIn({ scopes: ['cards:read'] })
    expect((await list()).status).toBe(403)

    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError())
    expect((await list()).status).toBe(401)
  })
})

describe('DELETE /api/oauth/grants/[id]', () => {
  it('revokes one of the caller’s grants and keeps the row', async () => {
    store.grants.push(grantRow('g1'), grantRow('g2'))

    const res = await remove('g1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    expect(store.grants.map(g => [g.id, g.revokedAt !== null])).toEqual([
      ['g1', true],
      ['g2', false]
    ])
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_REVOKED,
        userId: 'user_1',
        metadata: expect.objectContaining({ grantId: 'g1', reason: 'user' })
      })
    )
  })

  it("answers 404 for someone else's grant and leaves it alone", async () => {
    store.grants.push(grantRow('theirs', { userId: 'user_2' }))
    const res = await remove('theirs')
    expect(res.status).toBe(404)
    expect(store.grants[0].revokedAt).toBeNull()
  })

  it('answers 404 for an unknown id or a caller without an account', async () => {
    expect((await remove('nope')).status).toBe(404)

    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    store.grants.push(grantRow('g1'))
    expect((await remove('g1')).status).toBe(404)
  })

  it('is idempotent and logs once', async () => {
    store.grants.push(grantRow('g1'))
    await remove('g1')
    const again = await remove('g1')
    expect(again.status).toBe(200)
    expect(logActivity.fireAndForget).toHaveBeenCalledTimes(1)
  })

  it('refuses device tokens', async () => {
    store.grants.push(grantRow('g1'))
    signIn({ scopes: ['cards:read'] })
    expect((await remove('g1')).status).toBe(403)
    expect(store.grants[0].revokedAt).toBeNull()
  })
})

describe('PATCH /api/oauth/grants/[id]', () => {
  beforeEach(() =>
    ownWallets({ id: 'w1', name: 'Spending' }, { id: 'w2', name: 'Savings' })
  )

  it('changes scopes, budget and wallets, and logs the change', async () => {
    store.grants.push(grantRow('g1'))

    const res = await update('g1', {
      scopes: ['spend'],
      spendLimitSats: 2000,
      walletIds: ['w2', 'w2']
    })
    expect(res.status).toBe(200)
    expect((await res.json()).grant).toMatchObject({
      id: 'g1',
      scopes: ['read', 'spend'],
      spendLimitSats: 2000,
      wallets: [{ id: 'w2', name: 'Savings' }]
    })
    expect(store.grants[0]).toMatchObject({
      scopes: ['read', 'spend'],
      spendLimitSats: 2000,
      allWallets: false,
      walletIds: ['w2']
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_UPDATED,
        level: 'WARN',
        metadata: expect.objectContaining({ grantId: 'g1', walletIds: ['w2'] })
      })
    )
  })

  it('widens to every wallet with walletIds null and drops the budget without spend', async () => {
    store.grants.push(
      grantRow('g1', {
        scopes: ['read', 'spend'],
        spendLimitSats: 500,
        allWallets: false,
        walletIds: ['w1']
      })
    )
    const res = await update('g1', { scopes: ['read'], walletIds: null })
    expect(res.status).toBe(200)
    expect(store.grants[0]).toMatchObject({
      scopes: ['read'],
      spendLimitSats: null,
      allWallets: true,
      walletIds: []
    })
  })

  it('refuses a wallet that is not the caller’s, spend without a budget, or no wallet', async () => {
    store.grants.push(grantRow('g1'))
    const before = { ...store.grants[0] }

    expect(
      (
        await update('g1', {
          scopes: ['spend'],
          spendLimitSats: 100,
          walletIds: ['someone_else']
        })
      ).status
    ).toBe(400)
    expect((await update('g1', { scopes: ['spend'] })).status).toBe(400)
    expect(
      (await update('g1', { scopes: ['read'], walletIds: [] })).status
    ).toBe(400)
    expect(store.grants[0]).toEqual(before)
  })

  it("answers 404 for someone else's or a revoked grant", async () => {
    store.grants.push(
      grantRow('theirs', { userId: 'user_2' }),
      grantRow('revoked', { revokedAt: new Date() })
    )
    expect((await update('theirs', { scopes: ['read'] })).status).toBe(404)
    expect((await update('revoked', { scopes: ['read'] })).status).toBe(404)
    expect(store.grants[0].scopes).toEqual(['read', 'write'])
  })

  it('refuses device tokens', async () => {
    store.grants.push(grantRow('g1'))
    signIn({ scopes: ['cards:read'] })
    expect((await update('g1', { scopes: ['read'] })).status).toBe(403)
  })
})
