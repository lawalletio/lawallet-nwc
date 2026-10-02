import { createHash } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetPrismaMock } from '@/tests/helpers/prisma-mock'
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

vi.mock('@/lib/activity-log', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/activity-log')>()),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

import { POST as tokenRoute } from '@/app/api/oauth/token/route'
import { POST as revokeRoute } from '@/app/api/oauth/revoke/route'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { createAuthorizationGrant, hashCredential } from '@/lib/oauth/grants'
import { verifyAccessToken } from '@/lib/oauth/access-token'
import type { OAuthScope } from '@/lib/oauth/constants'

const RESOURCE = 'https://example.org/api/mcp'
const REDIRECT = 'http://localhost:61000/callback'
const VERIFIER = 'Aa0-._~'.repeat(7)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const DAY = 24 * 60 * 60 * 1000

let store: FakeOAuthStore

type Body = Record<string, string>

function post(
  route: (request: Request) => Promise<Response>,
  path: string,
  body: Body | string,
  as: 'form' | 'json' = 'form'
) {
  return route(
    new Request(`https://example.org${path}`, {
      method: 'POST',
      headers: {
        'content-type':
          as === 'form'
            ? 'application/x-www-form-urlencoded'
            : 'application/json'
      },
      body:
        typeof body === 'string'
          ? body
          : as === 'form'
            ? new URLSearchParams(body).toString()
            : JSON.stringify(body)
    })
  )
}

const token = (body: Body | string, as?: 'form' | 'json') =>
  post(tokenRoute, '/api/oauth/token', body, as)
const revoke = (body: Body | string, as?: 'form' | 'json') =>
  post(revokeRoute, '/api/oauth/revoke', body, as)

async function expectOAuthError(res: Response, error: string) {
  expect(res.status).toBe(400)
  expect(res.headers.get('cache-control')).toBe('no-store')
  const body = await res.json()
  expect(body).toEqual({ error, error_description: expect.any(String) })
}

function approve(
  scopes: OAuthScope[] = ['read', 'write'],
  spendLimitSats: number | null = null
) {
  return createAuthorizationGrant({
    userId: 'user_1',
    client: { id: 'client_1', name: 'Claude' },
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    resource: RESOURCE,
    scopes,
    spendLimitSats
  })
}

function exchangeBody(code: string, overrides: Body = {}): Body {
  return {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: 'client_1',
    code_verifier: VERIFIER,
    resource: RESOURCE,
    ...overrides
  }
}

async function connect() {
  const res = await token(exchangeBody(await approve()))
  expect(res.status).toBe(200)
  return (await res.json()) as {
    access_token: string
    refresh_token: string
  }
}

function refreshBody(refreshToken: string, overrides: Body = {}): Body {
  return {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'client_1',
    resource: RESOURCE,
    ...overrides
  }
}

const grant = () => store.grants.at(-1)!

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  store = installFakeOAuthStore()
  for (const id of ['client_1', 'client_2']) {
    store.clients.push({
      id,
      name: 'Claude',
      redirectUris: [REDIRECT],
      createdAt: new Date()
    })
  }
  store.users.set('user_1', { id: 'user_1', pubkey: 'a'.repeat(64) })
})

// ── authorization_code ────────────────────────────────────────────────────

describe('POST /api/oauth/token — authorization_code', () => {
  it('issues a token pair for a form-encoded exchange', async () => {
    const res = await token(exchangeBody(await approve()))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('pragma')).toBe('no-cache')
    const body = await res.json()
    expect(body).toEqual({
      access_token: expect.stringMatching(/^lwat_[A-Za-z0-9_-]{43}$/),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^lwrt_[A-Za-z0-9_-]{43}$/),
      scope: 'read write'
    })
    expect(grant()).toMatchObject({
      codeUsedAt: expect.any(Date),
      accessTokenHash: hashCredential(body.access_token),
      refreshTokenHash: hashCredential(body.refresh_token)
    })
    expect(JSON.stringify(store.grants)).not.toContain(body.access_token)
    expect(JSON.stringify(store.grants)).not.toContain(body.refresh_token)
    await expect(
      verifyAccessToken(body.access_token, RESOURCE)
    ).resolves.toMatchObject({ grantId: grant().id, scopes: ['read', 'write'] })
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), {
      bucket: 'oauthToken',
      maxRequests: 60,
      windowMs: 60_000
    })
  })

  it('accepts JSON, no resource, or the bare origin as resource', async () => {
    const json = await token(exchangeBody(await approve()), 'json')
    expect(json.status).toBe(200)

    const { resource: _resource, ...withoutResource } = exchangeBody(
      await approve()
    )
    expect((await token(withoutResource)).status).toBe(200)

    const origin = await token(
      exchangeBody(await approve(), { resource: 'https://example.org' })
    )
    expect(origin.status).toBe(200)
  })

  it('refuses an unknown client with invalid_client', async () => {
    await expectOAuthError(
      await token(exchangeBody(await approve(), { client_id: 'gone' })),
      'invalid_client'
    )
  })

  it('refuses an unknown code', async () => {
    await expectOAuthError(
      await token(exchangeBody('lwac_not-a-real-code')),
      'invalid_grant'
    )
  })

  it('refuses an expired code', async () => {
    const code = await approve()
    grant().codeExpiresAt = new Date(Date.now() - 1)
    await expectOAuthError(await token(exchangeBody(code)), 'invalid_grant')
  })

  it('refuses the code of a revoked grant', async () => {
    const code = await approve()
    grant().revokedAt = new Date()
    await expectOAuthError(await token(exchangeBody(code)), 'invalid_grant')
  })

  it.each([
    ['another client', { client_id: 'client_2' }],
    ['another redirect URI', { redirect_uri: 'https://app.example.com/cb' }],
    [
      'the redirect URI on another port',
      { redirect_uri: 'http://localhost:61001/callback' }
    ],
    ['a wrong PKCE verifier', { code_verifier: 'x'.repeat(43) }]
  ])('refuses %s without consuming the code', async (_label, change) => {
    const code = await approve()
    await expectOAuthError(
      await token(exchangeBody(code, change)),
      'invalid_grant'
    )
    expect(grant().codeUsedAt).toBeNull()
    expect((await token(exchangeBody(code))).status).toBe(200)
  })

  it('refuses another resource with invalid_target', async () => {
    await expectOAuthError(
      await token(
        exchangeBody(await approve(), {
          resource: 'https://other.example/api/mcp'
        })
      ),
      'invalid_target'
    )
  })

  it.each([
    ['a short verifier', { code_verifier: 'x'.repeat(42) }],
    [
      'a verifier with reserved characters',
      { code_verifier: `${'x'.repeat(43)}+` }
    ],
    ['a verifier over 128 characters', { code_verifier: 'x'.repeat(129) }]
  ])('refuses %s as a malformed request', async (_label, change) => {
    await expectOAuthError(
      await token(exchangeBody(await approve(), change)),
      'invalid_request'
    )
  })

  it.each(['code', 'code_verifier', 'redirect_uri', 'client_id'])(
    'refuses a request without %s',
    async param => {
      const body = exchangeBody(await approve())
      delete body[param]
      await expectOAuthError(await token(body), 'invalid_request')
    }
  )

  it('revokes the grant when a used code comes back', async () => {
    const code = await approve()
    const first = await (await token(exchangeBody(code))).json()

    await expectOAuthError(await token(exchangeBody(code)), 'invalid_grant')

    expect(grant().revokedAt).toBeInstanceOf(Date)
    await expect(
      verifyAccessToken(first.access_token, RESOURCE)
    ).rejects.toThrow('revoked')
    await expectOAuthError(
      await token(refreshBody(first.refresh_token)),
      'invalid_grant'
    )
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_REVOKED,
        level: 'WARN',
        metadata: expect.objectContaining({ reason: 'code_replay' })
      })
    )
  })

  it('replaces the account’s earlier grants for the client only once the new code is exchanged', async () => {
    const earlier = await connect()
    const otherClient = {
      id: 'other_client',
      clientId: 'client_2',
      userId: 'user_1',
      revokedAt: null,
      createdAt: new Date(0)
    }
    const otherUser = {
      id: 'other_user',
      clientId: 'client_1',
      userId: 'user_2',
      revokedAt: null,
      createdAt: new Date(0)
    }
    store.grants.push(otherClient, otherUser)
    const first = store.grants.find(g => g.codeUsedAt)!

    const code = await approve()
    // Consent alone changes nothing: the earlier connection keeps working.
    expect(first.revokedAt).toBeNull()

    const res = await token(exchangeBody(code))
    expect(res.status).toBe(200)
    expect(first.revokedAt).toBeInstanceOf(Date)
    expect(grant().revokedAt).toBeNull()
    expect(otherClient.revokedAt).toBeNull()
    expect(otherUser.revokedAt).toBeNull()
    const refresh = await token(refreshBody(earlier.refresh_token))
    await expectOAuthError(refresh, 'invalid_grant')
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason: 'replaced',
          replacedGrants: 1
        })
      })
    )
  })

  it('lets exactly one of two concurrent exchanges win, then revokes', async () => {
    const code = await approve()
    const results = await Promise.all([
      token(exchangeBody(code)),
      token(exchangeBody(code))
    ])
    expect(results.map(r => r.status).sort()).toEqual([200, 400])
    expect(grant().revokedAt).toBeInstanceOf(Date)
  })
})

describe('POST /api/oauth/token — request shape', () => {
  it.each(['client_credentials', 'password', 'implicit'])(
    'refuses grant_type=%s',
    async grantType => {
      await expectOAuthError(
        await token({ grant_type: grantType, client_id: 'client_1' }),
        'unsupported_grant_type'
      )
    }
  )

  it('refuses a missing grant_type', async () => {
    await expectOAuthError(
      await token({ client_id: 'client_1' }),
      'invalid_request'
    )
  })

  it('refuses a parameter sent twice', async () => {
    const code = await approve()
    const body = `${new URLSearchParams(exchangeBody(code))}&code_verifier=${VERIFIER}`
    await expectOAuthError(await token(body), 'invalid_request')
  })

  it('refuses malformed JSON', async () => {
    await expectOAuthError(
      await token('{"grant_type":', 'json'),
      'invalid_request'
    )
  })
})

// ── refresh_token ─────────────────────────────────────────────────────────

describe('POST /api/oauth/token — refresh_token', () => {
  it('rotates both tokens and slides the refresh window', async () => {
    const first = await connect()
    grant().refreshExpiresAt = new Date(Date.now() + 60_000)

    const res = await token(refreshBody(first.refresh_token))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const second = await res.json()
    expect(second).toMatchObject({ token_type: 'Bearer', scope: 'read write' })
    expect(second.access_token).not.toBe(first.access_token)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(grant().refreshExpiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY
    )

    await expect(
      verifyAccessToken(second.access_token, RESOURCE)
    ).resolves.toBeTruthy()
    await expect(
      verifyAccessToken(first.access_token, RESOURCE)
    ).rejects.toThrow()
    await expectOAuthError(
      await token(refreshBody(first.refresh_token)),
      'invalid_grant'
    )
  })

  it('accepts JSON, no resource, or the bare origin', async () => {
    let { refresh_token } = await connect()
    for (const [body, as] of [
      [refreshBody(refresh_token), 'json'],
      [refreshBody(refresh_token, { resource: 'https://example.org/' }), 'form']
    ] as const) {
      const res = await token({ ...body, refresh_token }, as)
      expect(res.status).toBe(200)
      refresh_token = (await res.json()).refresh_token
    }
    const { resource: _resource, ...withoutResource } =
      refreshBody(refresh_token)
    expect((await token(withoutResource)).status).toBe(200)
  })

  it.each([
    ['expired', { refreshExpiresAt: new Date(Date.now() - 1) }],
    ['revoked', { revokedAt: new Date() }]
  ])('refuses a refresh token of a %s grant', async (_label, change) => {
    const { refresh_token } = await connect()
    Object.assign(grant(), change)
    await expectOAuthError(
      await token(refreshBody(refresh_token)),
      'invalid_grant'
    )
  })

  it('refuses an unknown refresh token', async () => {
    await expectOAuthError(
      await token(refreshBody('lwrt_never-issued')),
      'invalid_grant'
    )
  })

  it('refuses another client, and an unregistered one', async () => {
    const { refresh_token } = await connect()
    await expectOAuthError(
      await token(refreshBody(refresh_token, { client_id: 'client_2' })),
      'invalid_grant'
    )
    await expectOAuthError(
      await token(refreshBody(refresh_token, { client_id: 'gone' })),
      'invalid_client'
    )
  })

  it('refuses another resource', async () => {
    const { refresh_token } = await connect()
    await expectOAuthError(
      await token(
        refreshBody(refresh_token, {
          resource: 'https://other.example/api/mcp'
        })
      ),
      'invalid_target'
    )
  })

  it('lets a refresh token be used once even under concurrency', async () => {
    const { refresh_token } = await connect()
    const results = await Promise.all([
      token(refreshBody(refresh_token)),
      token(refreshBody(refresh_token))
    ])
    expect(results.map(r => r.status).sort()).toEqual([200, 400])
  })
})

// ── revocation ────────────────────────────────────────────────────────────

describe('POST /api/oauth/revoke', () => {
  it('revokes the grant behind an access token', async () => {
    const { access_token, refresh_token } = await connect()

    const res = await revoke({
      token: access_token,
      token_type_hint: 'access_token'
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})

    expect(grant().revokedAt).toBeInstanceOf(Date)
    await expect(verifyAccessToken(access_token, RESOURCE)).rejects.toThrow()
    await expectOAuthError(
      await token(refreshBody(refresh_token)),
      'invalid_grant'
    )
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_REVOKED,
        level: 'INFO',
        metadata: expect.objectContaining({ reason: 'client' })
      })
    )
  })

  it('revokes the grant behind a refresh token (JSON)', async () => {
    const { access_token, refresh_token } = await connect()
    expect((await revoke({ token: refresh_token }, 'json')).status).toBe(200)
    await expect(verifyAccessToken(access_token, RESOURCE)).rejects.toThrow()
  })

  it('answers 200 for an unknown token and changes nothing', async () => {
    await connect()
    const res = await revoke({ token: 'garbage' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(grant().revokedAt).toBeNull()
    expect(logActivity.fireAndForget).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: ActivityEvent.OAUTH_GRANT_REVOKED })
    )
  })

  it('logs a revocation once, at WARN for a spending grant', async () => {
    const code = await approve(['read', 'spend'], 1000)
    const { access_token } = await (await token(exchangeBody(code))).json()
    vi.mocked(logActivity.fireAndForget).mockClear()

    await revoke({ token: access_token })
    await revoke({ token: access_token })

    expect(logActivity.fireAndForget).toHaveBeenCalledTimes(1)
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'WARN' })
    )
  })

  it('refuses a request without a token', async () => {
    await expectOAuthError(await revoke({}), 'invalid_request')
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: 'oauthToken' })
    )
  })
})
