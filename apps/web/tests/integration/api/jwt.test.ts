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
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  createJwtToken: vi.fn(),
  validateJwtFromRequest: vi.fn(),
}))

import { GET, POST } from '@/app/api/jwt/route'
import { getConfig } from '@/lib/config'
import { createJwtToken, validateJwtFromRequest } from '@/lib/jwt'
import { validateNip98 } from '@/lib/nip98'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'

const PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/jwt', () => {
  it('creates JWT token with NIP-98 authentication', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})
    vi.mocked(createJwtToken).mockReturnValue('mock-jwt-token')

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      headers: { authorization: 'Nostr dGVzdA==' },
      body: { expiresIn: '1h' },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      token: 'mock-jwt-token',
      expiresIn: '1h',
      type: 'Bearer',
    })

    // Verify JWT was created with pubkey, role, and permissions
    expect(createJwtToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PUBKEY,
        pubkey: PUBKEY,
        role: 'ADMIN',
        permissions: expect.any(Array),
      }),
      'test-secret',
      expect.objectContaining({ issuer: 'lawallet-nwc' })
    )
  })

  it('rejects request without NIP-98 auth', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(validateNip98).mockRejectedValue(new Error('missing auth'))

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      body: { expiresIn: '1h' },
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('returns error when JWT not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      headers: { authorization: 'Nostr dGVzdA==' },
    })
    const res = await POST(req)

    expect(res.status).toBe(500)
  })

  it('defaults to USER role when not found in DB', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'test-secret' },
      maintenance: { enabled: false },
    } as any)
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different_pubkey' })
    vi.mocked(createJwtToken).mockReturnValue('mock-jwt-token')

    const req = createNextRequest('/api/jwt', {
      method: 'POST',
      headers: { authorization: 'Nostr dGVzdA==' },
    })
    const res = await POST(req)
    await assertResponse(res, 200)

    expect(createJwtToken).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'USER',
        permissions: [],
      }),
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
        sub: PUBKEY,
        pubkey: PUBKEY,
        role: 'ADMIN',
        permissions: ['settings:read', 'settings:write'],
        iat: 1000000,
        exp: 1003600,
      },
      header: { alg: 'HS256' },
    } as any)

    const req = createNextRequest('/api/jwt', {
      headers: { authorization: 'Bearer test-token' },
    })
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.valid).toBe(true)
    expect(body.pubkey).toBe(PUBKEY)
    expect(body.role).toBe('ADMIN')
    expect(body.permissions).toEqual(['settings:read', 'settings:write'])
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
