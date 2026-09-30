import { createHash } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  installFakeOAuthStore,
  type FakeOAuthStore
} from '@/tests/unit/lib/oauth/fake-oauth-store'
import { AuthenticationError } from '@/types/server/errors'

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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ endpoint: 'https://example.org' }))
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

vi.mock('@/lib/user', () => ({ createNewUser: vi.fn() }))

vi.mock('@/lib/activity-log', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/activity-log')>()),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

import { GET, POST } from '@/app/api/oauth/authorize/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { hashCredential } from '@/lib/oauth/grants'
import {
  AUTH_CODE_TTL_SECONDS,
  MAX_SPEND_LIMIT_SATS
} from '@/lib/oauth/constants'

const PUBKEY = 'a'.repeat(64)
const API_URL = 'https://example.org'
const RESOURCE = 'https://example.org/api/mcp'
const VERIFIER = 'verifier-'.repeat(6)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const REDIRECT = 'https://app.example.com/cb?tenant=a'

const REQUEST = {
  client_id: 'client_1',
  redirect_uri: REDIRECT,
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'xyz'
}

let store: FakeOAuthStore

function seedClient(
  id = 'client_1',
  redirectUris = [
    REDIRECT,
    'http://localhost/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'com.example.app:/oauth2redirect'
  ]
) {
  store.clients.push({
    id,
    name: 'Claude',
    redirectUris,
    createdAt: new Date()
  })
}

function validate(query: Record<string, string>) {
  return GET(createNextRequest('/api/oauth/authorize', { searchParams: query }))
}

function decide(body: Record<string, unknown>) {
  return POST(
    createNextRequest('/api/oauth/authorize', { method: 'POST', body })
  )
}

async function redirectOf(res: Response) {
  expect(res.status).toBe(200)
  return new URL((await res.json()).redirectTo)
}

function signIn(overrides: Record<string, unknown> = {}) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as never,
    method: 'jwt',
    ...overrides
  })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  store = installFakeOAuthStore()
  seedClient()
  signIn()
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: 'user_1', pubkey: PUBKEY, role: 'USER' }
  } as never)
})

// ── GET: validate for the consent screen ──────────────────────────────────

describe('GET /api/oauth/authorize', () => {
  it('describes a valid request', async () => {
    const res = await validate({ ...REQUEST, scope: 'read write' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      client: { id: 'client_1', name: 'Claude' },
      redirectUri: REDIRECT,
      redirectHost: 'app.example.com',
      scopes: ['read', 'write'],
      resource: RESOURCE,
      defaultSpendLimitSats: 10_000,
      maxSpendLimitSats: MAX_SPEND_LIMIT_SATS
    })
  })

  it.each([
    [undefined, ['read', 'write', 'spend']],
    ['openid profile', ['read', 'write', 'spend']],
    ['write offline_access', ['read', 'write']],
    ['spend', ['read', 'spend']]
  ])('offers scopes for scope=%s', async (scope, expected) => {
    const res = await validate(scope ? { ...REQUEST, scope } : REQUEST)
    expect((await res.json()).scopes).toEqual(expected)
  })

  it('matches a loopback redirect URI on any port', async () => {
    const res = await validate({
      ...REQUEST,
      redirect_uri: 'http://localhost:54321/callback'
    })
    const body = await res.json()
    expect(body.redirectUri).toBe('http://localhost:54321/callback')
    expect(body.redirectHost).toBe('localhost:54321')
  })

  it('shows the host of a native scheme, and nothing for a host-less one', async () => {
    const cursor = await validate({
      ...REQUEST,
      redirect_uri: 'cursor://anysphere.cursor-mcp/oauth/callback'
    })
    expect((await cursor.json()).redirectHost).toBe(
      'cursor://anysphere.cursor-mcp'
    )
    const hostless = await validate({
      ...REQUEST,
      redirect_uri: 'com.example.app:/oauth2redirect'
    })
    expect((await hostless.json()).redirectHost).toBe('')
  })

  it.each([
    ['https://example.org', RESOURCE],
    ['https://EXAMPLE.org/api/mcp/', RESOURCE]
  ])(
    'accepts resource=%s and binds to the MCP URL',
    async (resource, bound) => {
      const res = await validate({ ...REQUEST, resource })
      expect((await res.json()).resource).toBe(bound)
    }
  )

  it('treats empty parameters as absent', async () => {
    const res = await validate({
      ...REQUEST,
      state: '',
      scope: '',
      resource: ''
    })
    expect(res.status).toBe(200)
  })

  const failures: [string, Record<string, string>, string][] = [
    ['an unknown client', { client_id: 'nope' }, 'invalid_client'],
    [
      'an unregistered redirect URI',
      { redirect_uri: 'https://evil.example/cb' },
      'invalid_request'
    ],
    [
      'a registered URI on another port (not loopback)',
      { redirect_uri: 'https://app.example.com:8443/cb?tenant=a' },
      'invalid_request'
    ],
    [
      'a loopback URI on another host',
      { redirect_uri: 'http://127.0.0.1:54321/callback' },
      'invalid_request'
    ],
    [
      'a loopback URI on another path',
      { redirect_uri: 'http://localhost:54321/other' },
      'invalid_request'
    ],
    [
      'an implicit-flow request',
      { response_type: 'token' },
      'unsupported_response_type'
    ],
    ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['a malformed challenge', { code_challenge: 'short' }, 'invalid_request'],
    [
      'another resource',
      { resource: 'https://other.example/api/mcp' },
      'invalid_target'
    ],
    [
      'the public MCP endpoint as resource',
      { resource: 'https://example.org/api/mcp/public' },
      'invalid_target'
    ]
  ]
  it.each(failures)('refuses %s', async (_label, change, error) => {
    const res = await validate({ ...REQUEST, ...change })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe(error)
    expect(body.error_description).toEqual(expect.any(String))
  })

  it.each([
    'code_challenge',
    'code_challenge_method',
    'response_type',
    'client_id',
    'redirect_uri'
  ])('refuses a request without %s', async param => {
    const query: Record<string, string> = { ...REQUEST }
    delete query[param]
    const res = await validate(query)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('refuses a parameter sent twice', async () => {
    const query = new URLSearchParams(REQUEST)
    query.append('redirect_uri', 'http://localhost/callback')
    const res = await GET(
      createNextRequest(`/api/oauth/authorize?${query.toString()}`)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_request',
      error_description: 'Parameter "redirect_uri" was sent more than once'
    })
  })
})

// ── POST: the user's decision ─────────────────────────────────────────────

describe('POST /api/oauth/authorize', () => {
  it('denies with access_denied, state and iss — and creates nothing', async () => {
    // Exactly what the consent page sends on "Deny".
    const url = await redirectOf(
      await decide({ ...REQUEST, approve: false, scopes: [] })
    )
    expect(url.origin + url.pathname).toBe('https://app.example.com/cb')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'a',
      error: 'access_denied',
      state: 'xyz',
      iss: API_URL
    })
    expect(store.grants).toHaveLength(0)
  })

  it('carries iss even without state', async () => {
    const { state: _state, ...withoutState } = REQUEST
    const url = await redirectOf(
      await decide({ ...withoutState, approve: false, scopes: [] })
    )
    expect(url.searchParams.has('state')).toBe(false)
    expect(url.searchParams.get('iss')).toBe(API_URL)
  })

  it('approves: a single-use code bound to client, redirect, PKCE and resource', async () => {
    const res = await decide({
      ...REQUEST,
      approve: true,
      scopes: ['read', 'write']
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
    const url = await redirectOf(res)
    const code = url.searchParams.get('code')!
    expect(code).toMatch(/^lwac_[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(url.searchParams.get('iss')).toBe(API_URL)
    expect(url.searchParams.get('tenant')).toBe('a')

    expect(store.grants).toHaveLength(1)
    const grant = store.grants[0]
    expect(grant).toMatchObject({
      clientId: 'client_1',
      userId: 'user_1',
      scopes: ['read', 'write'],
      resource: RESOURCE,
      spendLimitSats: null,
      codeHash: hashCredential(code),
      codeChallenge: CHALLENGE,
      redirectUri: REDIRECT,
      codeUsedAt: null
    })
    expect(JSON.stringify(grant)).not.toContain(code)
    expect(grant.codeExpiresAt.getTime() - Date.now()).toBeGreaterThan(
      (AUTH_CODE_TTL_SECONDS - 5) * 1000
    )
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_CREATED,
        level: 'INFO',
        userId: 'user_1'
      })
    )
  })

  it('adds read to write and to spend', async () => {
    await decide({ ...REQUEST, approve: true, scopes: ['write'] })
    expect(store.grants[0].scopes).toEqual(['read', 'write'])

    await decide({
      ...REQUEST,
      approve: true,
      scopes: ['spend'],
      spendLimitSats: 2000
    })
    expect(store.grants[1].scopes).toEqual(['read', 'spend'])
  })

  it('stores the spend budget and logs the grant at WARN', async () => {
    await decide({
      ...REQUEST,
      approve: true,
      scopes: ['read', 'write', 'spend'],
      spendLimitSats: 25_000
    })
    expect(store.grants[0].spendLimitSats).toBe(25_000)
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ActivityEvent.OAUTH_GRANT_CREATED,
        level: 'WARN'
      })
    )
  })

  it('ignores a budget when spend is not granted', async () => {
    await decide({
      ...REQUEST,
      approve: true,
      scopes: ['read'],
      spendLimitSats: 5000
    })
    expect(store.grants[0].spendLimitSats).toBeNull()
  })

  it.each([
    ['no scopes', { scopes: [] }],
    ['a missing scope list', {}],
    ['an unknown scope', { scopes: ['admin'] }],
    ['spend without a budget', { scopes: ['spend'] }],
    ['a zero budget', { scopes: ['spend'], spendLimitSats: 0 }],
    [
      'a budget above the maximum',
      { scopes: ['spend'], spendLimitSats: MAX_SPEND_LIMIT_SATS + 1 }
    ],
    ['a fractional budget', { scopes: ['spend'], spendLimitSats: 1.5 }],
    [
      'a scope the client did not request',
      { scope: 'read', scopes: ['read', 'spend'], spendLimitSats: 10 }
    ]
  ])('refuses an approval with %s', async (_label, change) => {
    const res = await decide({ ...REQUEST, approve: true, ...change })
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
    expect(store.grants).toHaveLength(0)
  })

  it('accepts the maximum budget', async () => {
    const res = await decide({
      ...REQUEST,
      approve: true,
      scopes: ['spend'],
      spendLimitSats: MAX_SPEND_LIMIT_SATS
    })
    expect(res.status).toBe(200)
  })

  it('replaces the account’s earlier grant for the same client only', async () => {
    seedClient('client_2')
    store.users.set('user_2', { id: 'user_2', pubkey: 'b'.repeat(64) })
    store.grants.push(
      {
        id: 'mine_same_client',
        clientId: 'client_1',
        userId: 'user_1',
        revokedAt: null,
        createdAt: new Date(0)
      },
      {
        id: 'mine_other_client',
        clientId: 'client_2',
        userId: 'user_1',
        revokedAt: null,
        createdAt: new Date(0)
      },
      {
        id: 'theirs_same_client',
        clientId: 'client_1',
        userId: 'user_2',
        revokedAt: null,
        createdAt: new Date(0)
      }
    )

    await decide({ ...REQUEST, approve: true, scopes: ['read'] })

    const revoked = Object.fromEntries(
      store.grants.map(g => [g.id, g.revokedAt !== null])
    )
    expect(revoked).toMatchObject({
      mine_same_client: true,
      mine_other_client: false,
      theirs_same_client: false
    })
    expect(store.grants.at(-1)!.revokedAt).toBeNull()
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ replacedGrants: 1 })
      })
    )
  })

  it('creates the account of a first-time pubkey', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    vi.mocked(createNewUser).mockResolvedValue({ id: 'user_new' } as never)

    await decide({ ...REQUEST, approve: true, scopes: ['read'] })

    expect(createNewUser).toHaveBeenCalledWith(PUBKEY)
    expect(store.grants[0].userId).toBe('user_new')
  })

  it('binds to the canonical MCP URL when the client names the origin', async () => {
    await decide({
      ...REQUEST,
      resource: 'https://example.org/',
      approve: true,
      scopes: ['read']
    })
    expect(store.grants[0].resource).toBe(RESOURCE)
  })

  it('redirects a loopback client to the port it listens on', async () => {
    const url = await redirectOf(
      await decide({
        ...REQUEST,
        redirect_uri: 'http://localhost:61000/callback',
        approve: true,
        scopes: ['read']
      })
    )
    expect(url.origin + url.pathname).toBe('http://localhost:61000/callback')
    expect(store.grants[0].redirectUri).toBe('http://localhost:61000/callback')
  })

  it('refuses a device token, which must not mint a broader credential', async () => {
    signIn({ scopes: ['cards:read'] })
    const res = await decide({ ...REQUEST, approve: true, scopes: ['read'] })
    expect(res.status).toBe(403)
    expect(store.grants).toHaveLength(0)
  })

  it('requires a session', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError())
    const res = await decide({ ...REQUEST, approve: false, scopes: [] })
    expect(res.status).toBe(401)
  })

  it('answers invalid requests with the app envelope', async () => {
    const unknown = await decide({
      ...REQUEST,
      client_id: 'nope',
      approve: true,
      scopes: ['read']
    })
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).success).toBe(false)

    for (const change of [
      { redirect_uri: 'https://evil.example/cb' },
      { resource: 'https://other.example/api/mcp' },
      { code_challenge_method: 'plain' }
    ]) {
      const res = await decide({
        ...REQUEST,
        ...change,
        approve: true,
        scopes: ['read']
      })
      expect(res.status).toBe(400)
      expect((await res.json()).success).toBe(false)
    }
    expect(store.grants).toHaveLength(0)
  })
})
