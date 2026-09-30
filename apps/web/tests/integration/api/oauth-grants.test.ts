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
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
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
import { DELETE } from '@/app/api/oauth/grants/[id]/route'
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
          createdAt: '2026-09-02T00:00:00.000Z',
          lastUsedAt: lastUsedAt.toISOString()
        },
        {
          id: 'older',
          clientName: 'Claude',
          scopes: ['read', 'write'],
          spendLimitSats: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          lastUsedAt: null
        }
      ]
    })
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
