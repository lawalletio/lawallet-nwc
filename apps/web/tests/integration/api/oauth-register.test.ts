import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  installFakeOAuthStore,
  type FakeOAuthStore
} from '@/tests/unit/lib/oauth/fake-oauth-store'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 },
    rateLimit: { enabled: false }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/middleware/rate-limit')>()),
  rateLimit: vi.fn()
}))

import { POST } from '@/app/api/oauth/register/route'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logger } from '@/lib/logger'

const DAY = 24 * 60 * 60 * 1000
let store: FakeOAuthStore

function register(body: unknown) {
  return POST(
    createNextRequest('/api/oauth/register', { method: 'POST', body })
  )
}

async function expectRejected(body: unknown, error: string) {
  const res = await register(body)
  expect(res.status).toBe(400)
  const json = await res.json()
  expect(json.error).toBe(error)
  expect(typeof json.error_description).toBe('string')
  expect(store.clients).toHaveLength(0)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  store = installFakeOAuthStore()
})

describe('POST /api/oauth/register', () => {
  it('registers a public client and says so, uncached', async () => {
    const res = await register({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback']
    })

    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({
      client_id: store.clients[0].id,
      client_id_issued_at: Math.floor(
        store.clients[0].createdAt.getTime() / 1000
      ),
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: 'oauthRegister', maxRequests: 30 })
    )
  })

  it('accepts and ignores what it does not honour, and never issues a secret', async () => {
    const res = await register({
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code', 'client_credentials'],
      response_types: ['code', 'token'],
      application_type: 'web',
      scope: 'openid read write',
      client_uri: 'https://chatgpt.com'
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token_endpoint_auth_method).toBe('none')
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token'])
    expect(body.response_types).toEqual(['code'])
    expect(body).not.toHaveProperty('client_secret')
    expect(Object.keys(store.clients[0]).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'redirectUris'
    ])
  })

  it("registers Cursor's URIs, private-use scheme included", async () => {
    const uris = [
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'http://localhost:8787/callback',
      'https://www.cursor.com/agents/mcp/oauth/callback'
    ]
    const res = await register({
      client_name: 'Cursor',
      redirect_uris: uris,
      application_type: 'native'
    })
    expect(res.status).toBe(201)
    expect((await res.json()).redirect_uris).toEqual(uris)
  })

  it('dedupes redirect URIs', async () => {
    const res = await register({
      redirect_uris: ['http://127.0.0.1:6276/cb', 'http://127.0.0.1:6276/cb']
    })
    expect((await res.json()).redirect_uris).toEqual([
      'http://127.0.0.1:6276/cb'
    ])
  })

  describe('client_name', () => {
    it.each([
      ['defaults when absent', undefined, 'MCP client'],
      ['defaults when only whitespace', '  \n\t ', 'MCP client'],
      ['strips control and bidi characters', 'Cl\u0000au‮de​\n', 'Claude'],
      ['keeps ordinary Unicode', 'Café ⚡', 'Café ⚡'],
      ['cuts at 100 characters', 'x'.repeat(150), 'x'.repeat(100)],
      [
        'cuts by code point, not UTF-16 unit',
        '⚡'.repeat(120),
        '⚡'.repeat(100)
      ]
    ])('%s', async (_label, name, expected) => {
      const res = await register({
        client_name: name,
        redirect_uris: ['https://app.example.com/cb']
      })
      expect((await res.json()).client_name).toBe(expected)
    })
  })

  describe('rejections', () => {
    it.each([
      ['javascript:alert(1)'],
      ['data:text/html,x'],
      ['vbscript:x'],
      ['file:///etc/passwd'],
      ['blob:https://example.org/x'],
      ['about:blank'],
      ['ws://localhost/cb'],
      ['wss://example.org/cb'],
      ['ftp://example.org/cb'],
      ['chrome://settings'],
      ['view-source:https://example.org'],
      ['intent://x#Intent;end'],
      ['http://example.org/cb'],
      ['https://example.org/cb#fragment'],
      ['https://claude.ai@evil.com/cb'],
      [`https://example.org/${'a'.repeat(2000)}`]
    ])('refuses the redirect URI %s', async uri => {
      await expectRejected(
        { redirect_uris: ['https://ok.example/cb', uri] },
        'invalid_redirect_uri'
      )
    })

    it('refuses a missing, empty or oversized redirect URI list', async () => {
      await expectRejected({ client_name: 'x' }, 'invalid_redirect_uri')
      await expectRejected({ redirect_uris: [] }, 'invalid_redirect_uri')
      await expectRejected(
        {
          redirect_uris: Array.from(
            { length: 11 },
            (_, i) => `https://app.example.com/${i}`
          )
        },
        'invalid_redirect_uri'
      )
    })

    it('refuses unusable metadata', async () => {
      await expectRejected(
        { client_name: 42, redirect_uris: ['https://app.example.com/cb'] },
        'invalid_client_metadata'
      )
      await expectRejected(
        {
          client_name: 'x'.repeat(1001),
          redirect_uris: ['https://app.example.com/cb']
        },
        'invalid_client_metadata'
      )
    })

    it('refuses malformed JSON', async () => {
      const res = await POST(
        new Request('http://localhost:3000/api/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"redirect_uris":'
        })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_client_metadata')
    })
  })

  describe('housekeeping', () => {
    const old = new Date(Date.now() - 31 * DAY)

    it('drops old unused clients and stale pending grants, and nothing else', async () => {
      store.clients.push(
        { id: 'old_unused', name: 'a', redirectUris: [], createdAt: old },
        {
          id: 'old_with_revoked_grant',
          name: 'b',
          redirectUris: [],
          createdAt: old
        },
        {
          id: 'old_with_live_grant',
          name: 'c',
          redirectUris: [],
          createdAt: old
        },
        {
          id: 'recent_unused',
          name: 'd',
          redirectUris: [],
          createdAt: new Date()
        },
        {
          id: 'old_with_stale_pending',
          name: 'e',
          redirectUris: [],
          createdAt: old
        }
      )
      store.grants.push(
        {
          id: 'revoked',
          clientId: 'old_with_revoked_grant',
          codeUsedAt: new Date(),
          codeExpiresAt: old,
          revokedAt: new Date()
        },
        {
          id: 'live',
          clientId: 'old_with_live_grant',
          codeUsedAt: new Date(),
          codeExpiresAt: old,
          revokedAt: null
        },
        {
          id: 'stale_pending',
          clientId: 'old_with_stale_pending',
          codeUsedAt: null,
          codeExpiresAt: new Date(Date.now() - 2 * DAY),
          revokedAt: null
        },
        {
          id: 'fresh_pending',
          clientId: 'recent_unused',
          codeUsedAt: null,
          codeExpiresAt: new Date(Date.now() - 60_000),
          revokedAt: null
        }
      )

      const res = await register({
        redirect_uris: ['https://app.example.com/cb']
      })
      expect(res.status).toBe(201)

      expect(store.clients.map(c => c.id)).toEqual([
        'old_with_revoked_grant',
        'old_with_live_grant',
        'recent_unused',
        // Its only grant goes in this pass; the client goes in a later one.
        'old_with_stale_pending',
        'client_1'
      ])
      expect(store.grants.map(g => g.id)).toEqual([
        'revoked',
        'live',
        'fresh_pending'
      ])
    })

    it('never blocks a registration', async () => {
      vi.mocked(prismaMock.oAuthClient.deleteMany).mockRejectedValueOnce(
        new Error('lock timeout')
      )
      const res = await register({
        redirect_uris: ['https://app.example.com/cb']
      })
      expect(res.status).toBe(201)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        'oauth.prune_failed'
      )
    })
  })
})
