import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AuthenticationError,
  ServiceUnavailableError
} from '@/types/server/errors'

const jwtConfig = { secret: 'test-jwt-secret', enabled: true }

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ jwt: jwtConfig }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/oauth/access-token', () => ({
  isOAuthAccessToken: (token: string) => token.startsWith('lwat_'),
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/auth/resolve-role', () => ({ resolveRole: vi.fn() }))
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://wallet.example')
}))

import {
  McpAuthError,
  resolveCaller,
  resolvePublicCaller,
  unauthorizedResponse
} from '@/lib/mcp/caller'
import { verifyAccessToken } from '@/lib/oauth/access-token'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { resolveRole } from '@/lib/auth/resolve-role'
import { verifyJwtToken } from '@/lib/jwt'
import { Role, getRolePermissions } from '@/lib/auth/permissions'

const PUBKEY = 'a'.repeat(64)

const request = (authorization?: string) =>
  new Request('https://wallet.example/api/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {}
  })

async function authError(promise: Promise<unknown>): Promise<McpAuthError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(McpAuthError)
  return error as McpAuthError
}

beforeEach(() => {
  vi.clearAllMocks()
  jwtConfig.enabled = true
})

describe('resolveCaller — OAuth access tokens', () => {
  beforeEach(() => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      grantId: 'grant1',
      clientId: 'client1',
      clientName: 'Claude',
      userId: 'user1',
      pubkey: PUBKEY,
      scopes: ['read', 'write', 'spend'],
      spendLimitSats: 5000
    })
    vi.mocked(resolveRole).mockResolvedValue(Role.OPERATOR)
  })

  it('verifies the token against this instance and mints an internal session', async () => {
    const caller = await resolveCaller(request('Bearer lwat_abc'))

    expect(verifyAccessToken).toHaveBeenCalledWith(
      'lwat_abc',
      'https://wallet.example/api/mcp'
    )
    expect(caller.user).toEqual({
      pubkey: PUBKEY,
      userId: 'user1',
      role: Role.OPERATOR
    })
    expect([...caller.scopes]).toEqual(['read', 'write', 'spend'])
    expect(caller.grant).toEqual({
      id: 'grant1',
      clientName: 'Claude',
      spendLimitSats: 5000
    })
    expect(caller.apiUrl).toBe('https://wallet.example')

    // Exactly the claims POST /api/jwt issues, valid for 60 seconds.
    const token = caller.authorization!.replace(/^Bearer /, '')
    const { payload } = verifyJwtToken(token, jwtConfig.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })
    expect(payload).toMatchObject({
      userId: 'user1',
      pubkey: PUBKEY,
      authPubkey: PUBKEY,
      role: 'OPERATOR'
    })
    expect(payload.permissions).toContain('cards:write')
    expect(payload.exp - payload.iat).toBe(60)
    // Same permissions as the role map, but marked as narrowed: the OAuth
    // consent endpoints refuse such a token, so a client cannot widen its grant.
    expect(payload.scopes).toEqual(getRolePermissions(Role.OPERATOR))
    expect(payload.kind).toBeUndefined()
  })

  it('carries an empty scopes claim for a plain user', async () => {
    vi.mocked(resolveRole).mockResolvedValue(Role.USER)
    const caller = await resolveCaller(request('Bearer lwat_abc'))
    const token = caller.authorization!.replace(/^Bearer /, '')
    const { payload } = verifyJwtToken(token, jwtConfig.secret)
    expect(payload.scopes).toEqual([])
    expect(payload.role).toBe('USER')
  })

  it('answers invalid_token when the token is rejected', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(
      new AuthenticationError('Token expired')
    )
    const error = await authError(resolveCaller(request('Bearer lwat_old')))
    expect(error.code).toBe('invalid_token')
    expect(error.apiUrl).toBe('https://wallet.example')
  })

  it('fails loudly (not 401) when JWTs are not configured', async () => {
    jwtConfig.enabled = false
    await expect(resolveCaller(request('Bearer lwat_abc'))).rejects.toThrow(
      'JWT authentication is not configured'
    )
  })
})

describe('resolveCaller — session and device JWTs', () => {
  it('passes the header through with read + write, never spend', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: 'b'.repeat(64),
      role: Role.ADMIN,
      method: 'jwt'
    })
    vi.mocked(resolveAccountByPubkey).mockResolvedValue({
      id: 'user2',
      primaryPubkey: PUBKEY,
      authPubkey: 'b'.repeat(64),
      role: 'ADMIN'
    })

    const caller = await resolveCaller(request('Bearer eyJ.session.jwt'))

    expect(caller.user).toEqual({
      pubkey: PUBKEY,
      userId: 'user2',
      role: Role.ADMIN
    })
    expect([...caller.scopes].sort()).toEqual(['read', 'write'])
    expect(caller.grant).toBeNull()
    expect(caller.authorization).toBe('Bearer eyJ.session.jwt')
    expect(verifyAccessToken).not.toHaveBeenCalled()
  })

  it('accepts a device token for a pubkey without an account', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: PUBKEY,
      role: Role.USER,
      method: 'jwt',
      scopes: []
    })
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)

    const caller = await resolveCaller(request('Bearer eyJ.device.jwt'))
    expect(caller.user).toEqual({ pubkey: PUBKEY, userId: null, role: 'USER' })
  })

  it('answers invalid_token when the JWT is rejected', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('Invalid or expired JWT')
    )
    const error = await authError(resolveCaller(request('Bearer eyJ.bad')))
    expect(error.code).toBe('invalid_token')
    expect(error.message).toBe('Invalid or expired JWT')
  })

  it('lets infrastructure failures through as they are', async () => {
    const outage = new ServiceUnavailableError('Could not resolve account role')
    vi.mocked(authenticate).mockRejectedValue(outage)
    await expect(resolveCaller(request('Bearer eyJ.x'))).rejects.toBe(outage)
  })
})

describe('resolveCaller — missing credentials', () => {
  it.each([
    [undefined, 'Authorization required'],
    ['Nostr eyJldmVudCI6e319', 'Only Bearer tokens are accepted here'],
    ['Bearer    ', 'Only Bearer tokens are accepted here'],
    ['bearer lwat_x', 'Only Bearer tokens are accepted here']
  ])('%s → unauthorized', async (header, message) => {
    const error = await authError(resolveCaller(request(header)))
    expect(error.code).toBe('unauthorized')
    expect(error.message).toBe(message)
    expect(authenticate).not.toHaveBeenCalled()
  })
})

describe('resolvePublicCaller', () => {
  it('is anonymous whatever credentials are presented', async () => {
    const caller = await resolvePublicCaller(request('Bearer lwat_abc'))
    expect(caller).toMatchObject({
      user: null,
      grant: null,
      authorization: null,
      apiUrl: 'https://wallet.example'
    })
    expect(caller.scopes.size).toBe(0)
    expect(verifyAccessToken).not.toHaveBeenCalled()
  })
})

describe('unauthorizedResponse', () => {
  it('challenges with the protected-resource metadata and no scope', async () => {
    const res = unauthorizedResponse(
      new McpAuthError(
        'unauthorized',
        'Authorization required',
        'https://w.example'
      )
    )
    expect(res.status).toBe(401)
    // Without `scope`, clients request every supported scope and the consent
    // screen decides.
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://w.example/.well-known/oauth-protected-resource/api/mcp"'
    )
    expect(await res.json()).toEqual({
      error: 'unauthorized',
      error_description: 'Authorization required'
    })
  })

  it('adds error="invalid_token" when a token was rejected', async () => {
    const res = unauthorizedResponse(
      new McpAuthError('invalid_token', 'Token expired', 'https://w.example')
    )
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://w.example/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"'
    )
    expect(await res.json()).toEqual({
      error: 'invalid_token',
      error_description: 'Token expired'
    })
  })
})
