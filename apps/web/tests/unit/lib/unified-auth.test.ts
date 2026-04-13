import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { Role, Permission } from '@/lib/auth/permissions'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'

// Mock dependencies
vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  validateJwtFromRequest: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: 'a'.repeat(32) },
  })),
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

import {
  authenticate,
  authenticateWithRole,
  authenticateWithPermission,
  withAuth,
} from '@/lib/auth/unified-auth'
import { validateNip98 } from '@/lib/nip98'
import { validateJwtFromRequest } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'

const PUBKEY = 'a'.repeat(64)

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

function mockNostrRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Nostr dGVzdA==' },
  })
}

function mockBearerRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer valid-jwt-token' },
  })
}

function mockNoAuthRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url, { method: 'GET' })
}

describe('authenticate', () => {
  describe('with NIP-98 (Nostr header)', () => {
    it('returns pubkey and role from DB', async () => {
      vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'OPERATOR' } as any)
      vi.mocked(getSettings).mockResolvedValue({})

      const result = await authenticate(mockNostrRequest())
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.role).toBe(Role.OPERATOR)
      expect(result.method).toBe('nip98')
    })

    it('falls back to Settings root for admin', async () => {
      vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
      vi.mocked(getSettings).mockResolvedValue({ root: PUBKEY })

      const result = await authenticate(mockNostrRequest())
      expect(result.role).toBe(Role.ADMIN)
      expect(result.method).toBe('nip98')
    })

    it('throws AuthenticationError on invalid NIP-98', async () => {
      vi.mocked(validateNip98).mockRejectedValue(new Error('bad event'))

      await expect(authenticate(mockNostrRequest())).rejects.toThrow(AuthenticationError)
    })
  })

  describe('with JWT (Bearer header)', () => {
    it('returns pubkey and role from JWT claims', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' },
      } as any)

      const result = await authenticate(mockBearerRequest())
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.role).toBe(Role.ADMIN)
      expect(result.method).toBe('jwt')
    })

    it('falls back to USER when JWT has invalid role', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'INVALID', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' },
      } as any)

      const result = await authenticate(mockBearerRequest())
      expect(result.role).toBe(Role.USER)
    })

    it('throws AuthenticationError when JWT missing pubkey', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { role: 'ADMIN', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' },
      } as any)

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(AuthenticationError)
    })

    it('throws AuthenticationError on invalid JWT', async () => {
      vi.mocked(validateJwtFromRequest).mockRejectedValue(new Error('invalid'))

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(AuthenticationError)
    })

    it('throws AuthenticationError when JWT not configured', async () => {
      vi.mocked(getConfig).mockReturnValue({
        jwt: { enabled: false, secret: undefined },
      } as any)

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(AuthenticationError)
    })
  })

  describe('without auth header', () => {
    it('throws AuthenticationError', async () => {
      await expect(authenticate(mockNoAuthRequest())).rejects.toThrow(AuthenticationError)
    })
  })

  describe('with unsupported auth scheme', () => {
    it('throws AuthenticationError', async () => {
      const request = new Request('http://localhost:3000/api/test', {
        headers: { Authorization: 'Basic abc123' },
      })
      await expect(authenticate(request)).rejects.toThrow(AuthenticationError)
    })
  })
})

describe('authenticateWithRole', () => {
  it('passes when role is sufficient', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticateWithRole(mockNostrRequest(), Role.ADMIN)
    expect(result.pubkey).toBe(PUBKEY)
  })

  it('throws AuthorizationError when role is insufficient', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      authenticateWithRole(mockNostrRequest(), Role.ADMIN)
    ).rejects.toThrow(AuthorizationError)
  })

  it('works with JWT auth too', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'a'.repeat(32) },
    } as any)
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
      header: { alg: 'HS256' },
    } as any)

    const result = await authenticateWithRole(mockBearerRequest(), Role.ADMIN)
    expect(result.pubkey).toBe(PUBKEY)
    expect(result.method).toBe('jwt')
  })
})

describe('authenticateWithPermission', () => {
  it('passes when role has the permission', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticateWithPermission(mockNostrRequest(), Permission.SETTINGS_WRITE)
    expect(result.pubkey).toBe(PUBKEY)
  })

  it('throws AuthorizationError when permission is denied', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      authenticateWithPermission(mockNostrRequest(), Permission.SETTINGS_WRITE)
    ).rejects.toThrow(AuthorizationError)
  })
})

describe('withAuth', () => {
  it('calls handler with auth result', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const wrapped = withAuth(handler)
    const response = await wrapped(mockNostrRequest())

    expect(handler).toHaveBeenCalled()
    const [, auth] = handler.mock.calls[0]
    expect(auth.pubkey).toBe(PUBKEY)
    expect(auth.role).toBe(Role.ADMIN)
    expect(response.status).toBe(200)
  })

  it('enforces requiredRole option', async () => {
    vi.mocked(validateNip98).mockResolvedValue({ pubkey: PUBKEY, event: {} as any })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    const handler = vi.fn()
    const wrapped = withAuth(handler, { requiredRole: Role.ADMIN })

    await expect(wrapped(mockNostrRequest())).rejects.toThrow(AuthorizationError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('enforces requireNip98 option (rejects Bearer)', async () => {
    // Even though JWT would be valid, requireNip98 forces NIP-98 path
    // which will fail because the Bearer request doesn't have a Nostr header
    vi.mocked(validateNip98).mockRejectedValue(new Error('not a Nostr auth header'))

    const handler = vi.fn()
    const wrapped = withAuth(handler, { requireNip98: true })

    // Bearer request should fail when NIP-98 is required
    await expect(wrapped(mockBearerRequest())).rejects.toThrow(AuthenticationError)
    expect(handler).not.toHaveBeenCalled()
  })
})
