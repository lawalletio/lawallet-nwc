import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  installFakeOAuthStore,
  type FakeOAuthStore
} from '@/tests/unit/lib/oauth/fake-oauth-store'
import { AuthenticationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { hashCredential } from '@/lib/oauth/grants'
import { isOAuthAccessToken, verifyAccessToken } from '@/lib/oauth/access-token'

const RESOURCE = 'https://example.org/api/mcp'
const TOKEN = 'lwat_valid-token'
const PUBKEY = 'a'.repeat(64)

let store: FakeOAuthStore

function seedGrant(overrides: Record<string, unknown> = {}) {
  store.clients.push({
    id: 'client_1',
    name: 'Claude',
    redirectUris: [],
    createdAt: new Date()
  })
  store.users.set('user_1', { id: 'user_1', pubkey: PUBKEY })
  const grant = {
    id: 'grant_1',
    clientId: 'client_1',
    userId: 'user_1',
    scopes: ['read', 'write'],
    resource: RESOURCE,
    spendLimitSats: null,
    accessTokenHash: hashCredential(TOKEN),
    accessExpiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides
  }
  store.grants.push(grant)
  return grant
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  store = installFakeOAuthStore()
})

describe('isOAuthAccessToken', () => {
  it('recognizes the access-token prefix only', () => {
    expect(isOAuthAccessToken('lwat_abc')).toBe(true)
    expect(isOAuthAccessToken('lwrt_abc')).toBe(false)
    expect(isOAuthAccessToken('eyJhbGciOi')).toBe(false)
  })
})

describe('verifyAccessToken', () => {
  it('resolves a valid token to its grant', async () => {
    seedGrant()
    await expect(verifyAccessToken(TOKEN, RESOURCE)).resolves.toEqual({
      grantId: 'grant_1',
      clientId: 'client_1',
      clientName: 'Claude',
      userId: 'user_1',
      pubkey: PUBKEY,
      scopes: ['read', 'write'],
      spendLimitSats: null
    })
  })

  it('carries the spend budget only alongside the spend scope', async () => {
    seedGrant({ scopes: ['read', 'spend'], spendLimitSats: 5000 })
    expect((await verifyAccessToken(TOKEN, RESOURCE)).spendLimitSats).toBe(5000)

    store.grants[0].scopes = ['read', 'write']
    expect((await verifyAccessToken(TOKEN, RESOURCE)).spendLimitSats).toBeNull()
  })

  it.each([
    ['an unknown token', {}, 'lwat_unknown', 'Unknown access token'],
    [
      'a token that is not an OAuth token',
      {},
      'eyJhbGciOi.x.y',
      'Unknown access token'
    ],
    [
      'a revoked grant',
      { revokedAt: new Date() },
      TOKEN,
      'Access token has been revoked'
    ],
    [
      'an expired token',
      { accessExpiresAt: new Date(Date.now() - 1) },
      TOKEN,
      'Access token has expired'
    ],
    [
      'a grant for another resource',
      { resource: 'https://other.example/api/mcp' },
      TOKEN,
      'Access token was issued for a different resource'
    ]
  ])('rejects %s', async (_label, overrides, token, message) => {
    seedGrant(overrides)
    const attempt = verifyAccessToken(token, RESOURCE)
    await expect(attempt).rejects.toBeInstanceOf(AuthenticationError)
    await expect(attempt).rejects.toThrow(message)
  })

  it('does not query the database for a non-OAuth bearer', async () => {
    await expect(verifyAccessToken('eyJ.x.y', RESOURCE)).rejects.toThrow()
    expect(prismaMock.oAuthGrant.findUnique).not.toHaveBeenCalled()
  })

  describe('lastUsedAt', () => {
    it('is written on first use', async () => {
      seedGrant()
      await verifyAccessToken(TOKEN, RESOURCE)
      await vi.waitFor(() =>
        expect(store.grants[0].lastUsedAt).toBeInstanceOf(Date)
      )
    })

    it('is not rewritten within a minute', async () => {
      const recent = new Date(Date.now() - 30_000)
      seedGrant({ lastUsedAt: recent })
      await verifyAccessToken(TOKEN, RESOURCE)
      expect(prismaMock.oAuthGrant.updateMany).not.toHaveBeenCalled()
      expect(store.grants[0].lastUsedAt).toBe(recent)
    })

    it('is refreshed after a minute', async () => {
      const stale = new Date(Date.now() - 61_000)
      seedGrant({ lastUsedAt: stale })
      await verifyAccessToken(TOKEN, RESOURCE)
      await vi.waitFor(() =>
        expect(store.grants[0].lastUsedAt.getTime()).toBeGreaterThan(
          stale.getTime()
        )
      )
    })

    it('never fails the request when the write fails', async () => {
      seedGrant()
      vi.mocked(prismaMock.oAuthGrant.updateMany).mockRejectedValueOnce(
        new Error('db down')
      )
      await expect(verifyAccessToken(TOKEN, RESOURCE)).resolves.toMatchObject({
        grantId: 'grant_1'
      })
      await vi.waitFor(() =>
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          'oauth.last_used_update_failed'
        )
      )
    })
  })
})
