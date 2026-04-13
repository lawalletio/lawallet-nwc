import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: 'test-secret' },
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@/lib/jwt', () => ({
  validateJwtFromRequest: vi.fn(),
}))

import { GET, POST } from '@/app/api/jwt/protected/route'
import { validateJwtFromRequest } from '@/lib/jwt'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/jwt/protected', () => {
  it('returns protected resource with JWT claims', async () => {
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        sub: 'user-123',
        userId: 'user-123',
        role: 'admin',
        iat: 1000000,
        exp: 1003600,
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt/protected', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.message).toBe('Access granted to protected resource')
    expect(body.userId).toBe('user-123')
    expect(body.userRole).toBe('admin')
  })

  it('rejects request without JWT', async () => {
    vi.mocked(validateJwtFromRequest).mockRejectedValue(new Error('no token'))

    const req = createNextRequest('/api/jwt/protected')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('rejects token missing required role claim', async () => {
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        sub: 'user-123',
        userId: 'user-123',
        iat: 1000000,
        exp: 1003600,
        // Missing 'role' claim
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt/protected', {
      headers: { authorization: 'Bearer token-without-role' },
    })
    const res = await GET(req)

    // GET requires 'role' claim
    expect(res.status).toBe(401)
  })
})

describe('POST /api/jwt/protected', () => {
  it('returns protected resource requiring both role and permissions', async () => {
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        sub: 'user-123',
        userId: 'user-123',
        role: 'admin',
        permissions: ['read', 'write'],
        iat: 1000000,
        exp: 1003600,
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt/protected', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body.message).toBe('Access granted to protected resource')
    expect(body.userPermissions).toEqual(['read', 'write'])
  })

  it('rejects token missing permissions claim', async () => {
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        sub: 'user-123',
        userId: 'user-123',
        role: 'admin',
        iat: 1000000,
        exp: 1003600,
        // Missing 'permissions' claim
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt/protected', {
      method: 'POST',
      headers: { authorization: 'Bearer token-without-perms' },
    })
    const res = await POST(req)

    // POST requires both 'role' and 'permissions' claims
    expect(res.status).toBe(401)
  })
})
