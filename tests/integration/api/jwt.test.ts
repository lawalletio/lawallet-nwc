import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
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

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@/lib/jwt', () => ({
  createJwtToken: vi.fn(),
  validateJwtFromRequest: vi.fn(),
}))

import { GET, POST } from '@/app/api/jwt/route'
import { getConfig } from '@/lib/config'
import { createJwtToken, validateJwtFromRequest } from '@/lib/jwt'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/jwt', () => {
  it('creates JWT token successfully', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(createJwtToken).mockReturnValue('mock-jwt-token')

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      body: { userId: 'user-123', expiresIn: '1h' },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      token: 'mock-jwt-token',
      expiresIn: '1h',
      type: 'Bearer',
    })
    expect(createJwtToken).toHaveBeenCalledWith(
      { sub: 'user-123' },
      'test-secret',
      expect.objectContaining({ issuer: 'lawallet-nwc' })
    )
  })

  it('returns error when JWT not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      body: { userId: 'user-123' },
    })
    const res = await POST(req)

    expect(res.status).toBe(500)
  })

  it('rejects missing userId', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('includes additional claims in token', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(createJwtToken).mockReturnValue('mock-jwt-token')

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      body: { userId: 'user-123', additionalClaims: { role: 'admin' } },
    })
    const res = await POST(req)
    await assertResponse(res, 200)

    expect(createJwtToken).toHaveBeenCalledWith(
      { sub: 'user-123', role: 'admin' },
      'test-secret',
      expect.anything()
    )
  })
})

describe('GET /api/jwt', () => {
  it('validates JWT token successfully', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        sub: 'user-123',
        iat: 1000000,
        exp: 1003600,
        role: 'admin',
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt', {
      headers: { authorization: 'Bearer test-token' },
    })
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.valid).toBe(true)
    expect(body.userId).toBe('user-123')
    expect(body.additionalClaims).toEqual({ role: 'admin' })
  })

  it('rejects missing authorization header', async () => {
    const req = createNextRequest('/api/jwt')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns error when JWT not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/jwt', {
      headers: { authorization: 'Bearer test-token' },
    })
    const res = await GET(req)

    expect(res.status).toBe(500)
  })
})
