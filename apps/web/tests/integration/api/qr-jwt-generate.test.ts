import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { Role } from '@/lib/auth/permissions'
import { AuthorizationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: () => 'test-req',
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { sensitive: { maxRequests: 5, maxRequestsAuth: 20 } },
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithRole: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/jwt', () => ({
  createJwtToken: vi.fn(() => 'signed.device.jwt'),
}))

vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://app.example.com'),
}))

import { POST } from '@/app/api/auth/qr-jwt/generate/route'
import { getConfig } from '@/lib/config'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { prisma } from '@/lib/prisma'
import { createJwtToken } from '@/lib/jwt'

const ADMIN_PUBKEY = 'a'.repeat(64)
const TARGET_PUBKEY = 'b'.repeat(64)

function asAdmin(role: Role = Role.ADMIN) {
  vi.mocked(authenticateWithRole).mockResolvedValue({
    pubkey: ADMIN_PUBKEY,
    role,
    method: 'jwt',
  } as any)
}

function configEnabled() {
  vi.mocked(getConfig).mockReturnValue({
    jwt: { enabled: true, secret: 'test-secret' },
    maintenance: { enabled: false },
  } as any)
}

function targetUser() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user_123',
    pubkey: TARGET_PUBKEY,
    role: 'OPERATOR',
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/qr-jwt/generate', () => {
  it('mints a scoped device token for an admin', async () => {
    asAdmin()
    configEnabled()
    targetUser()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: {
        userId: 'user_123',
        permissions: ['cards:read', 'cards:write'],
        expiresIn: '8h',
      },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body.jwt).toBe('signed.device.jwt')
    expect(body.expiresIn).toBe('8h')
    expect(body.scopes).toEqual(['cards:read', 'cards:write'])
    expect(body.apiUrl).toBe('https://app.example.com')
    expect(body.user).toEqual({
      id: 'user_123',
      pubkey: TARGET_PUBKEY,
      role: 'OPERATOR',
    })

    // The minted token carries the target identity, scopes claim, and the
    // platform URL it's scoped to.
    expect(createJwtToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pubkey: TARGET_PUBKEY,
        role: 'OPERATOR',
        scopes: ['cards:read', 'cards:write'],
        sub: 'user_123',
        kind: 'device',
        apiUrl: 'https://app.example.com',
      }),
      'test-secret',
      expect.objectContaining({ issuer: 'lawallet-nwc' }),
    )
  })

  it('de-duplicates repeated permissions', async () => {
    asAdmin()
    configEnabled()
    targetUser()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: {
        userId: 'user_123',
        permissions: ['cards:read', 'cards:read', 'ntags:read'],
        expiresIn: '1h',
      },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)
    expect(body.scopes).toEqual(['cards:read', 'ntags:read'])
  })

  it('rejects non-admins with 403', async () => {
    vi.mocked(authenticateWithRole).mockRejectedValue(
      new AuthorizationError('Not authorized to access this resource'),
    )
    configEnabled()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-jwt' },
      body: { userId: 'user_123', permissions: ['cards:read'], expiresIn: '8h' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an unknown permission with 400', async () => {
    asAdmin()
    configEnabled()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: {
        userId: 'user_123',
        permissions: ['cards:read', 'totally:bogus'],
        expiresIn: '8h',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects a permission the caller does not hold with 403', async () => {
    // Defensive guard: even though the real role gate forces ADMIN, a non-admin
    // role here must not be able to grant a scope it lacks.
    asAdmin(Role.OPERATOR)
    configEnabled()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer op-jwt' },
      body: {
        userId: 'user_123',
        permissions: ['settings:write'],
        expiresIn: '8h',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects an empty permission list with 400', async () => {
    asAdmin()
    configEnabled()

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { userId: 'user_123', permissions: [], expiresIn: '8h' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('accepts a long expiration (no maximum) but still enforces the 1-minute floor', async () => {
    asAdmin()
    configEnabled()
    targetUser()

    // A long lifetime now succeeds — there is no upper bound.
    const longReq = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { userId: 'user_123', permissions: ['cards:read'], expiresIn: '365d' },
    })
    const longRes = await POST(longReq)
    const longBody: any = await assertResponse(longRes, 200)
    expect(longBody.expiresIn).toBe('365d')

    // A sub-minute lifetime is still rejected.
    const shortReq = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { userId: 'user_123', permissions: ['cards:read'], expiresIn: '30s' },
    })
    const shortRes = await POST(shortReq)
    expect(shortRes.status).toBe(400)
  })

  it('returns 404 when the target user does not exist', async () => {
    asAdmin()
    configEnabled()
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { userId: 'missing', permissions: ['cards:read'], expiresIn: '8h' },
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('returns 500 when JWT is not configured', async () => {
    asAdmin()
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/auth/qr-jwt/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { userId: 'user_123', permissions: ['cards:read'], expiresIn: '8h' },
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
