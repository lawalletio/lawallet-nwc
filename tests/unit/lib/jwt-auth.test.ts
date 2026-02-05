import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { Role, Permission } from '@/lib/auth/permissions'
import {
  AuthenticationError,
  AuthorizationError,
  InternalServerError,
} from '@/types/server/errors'
import { createJwtToken } from '@/lib/jwt'

// Mock getConfig
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(32), enabled: true },
  })),
}))

import {
  authenticateJwt,
  withJwtAuth,
  getUserIdFromRequest,
  getClaimFromRequest,
  hasClaim,
  getRoleFromRequest,
  hasPermissionFromRequest,
  type AuthenticatedRequest,
} from '@/lib/jwt-auth'
import { getConfig } from '@/lib/config'

const SECRET = 'a'.repeat(32)

// Suppress console.error noise from the source code during tests
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getConfig).mockReturnValue({
    jwt: { secret: SECRET, enabled: true },
  } as any)
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

function createToken(overrides: Record<string, any> = {}) {
  return createJwtToken(
    { userId: 'user_1', ...overrides },
    SECRET,
    { issuer: 'lawallet-nwc', audience: 'lawallet-users' }
  )
}

function createNextReq(token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  return new NextRequest(new URL('http://localhost:3000/api/test'), {
    headers,
  })
}

describe('authenticateJwt', () => {
  it('returns validation result for valid token', async () => {
    const token = createToken()
    const request = createNextReq(token)
    const result = await authenticateJwt(request)
    expect(result.payload.userId).toBe('user_1')
  })

  it('throws InternalServerError when JWT is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { secret: undefined, enabled: false },
    } as any)
    const request = createNextReq('some-token')
    await expect(authenticateJwt(request)).rejects.toThrow(AuthenticationError)
  })

  it('throws AuthenticationError for invalid token', async () => {
    const request = createNextReq('invalid-token')
    await expect(authenticateJwt(request)).rejects.toThrow(AuthenticationError)
  })

  it('throws AuthenticationError for missing Authorization header', async () => {
    const request = createNextReq()
    await expect(authenticateJwt(request)).rejects.toThrow(AuthenticationError)
  })

  it('checks required claims', async () => {
    const token = createToken()
    const request = createNextReq(token)
    await expect(
      authenticateJwt(request, { requiredClaims: ['missingClaim'] })
    ).rejects.toThrow(AuthenticationError)
  })

  it('passes when required claims are present', async () => {
    const token = createToken({ customClaim: 'value' })
    const request = createNextReq(token)
    const result = await authenticateJwt(request, {
      requiredClaims: ['userId', 'customClaim'],
    })
    expect(result.payload.customClaim).toBe('value')
  })
})

describe('withJwtAuth', () => {
  it('wraps handler and attaches jwt to request', async () => {
    const token = createToken()
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const wrapped = withJwtAuth(handler)

    const request = createNextReq(token)
    const response = await wrapped(request)
    expect(handler).toHaveBeenCalled()
    const calledRequest = handler.mock.calls[0][0] as AuthenticatedRequest
    expect(calledRequest.jwt).toBeDefined()
    expect(calledRequest.jwt!.payload.userId).toBe('user_1')
  })

  it('throws AuthenticationError and does not call handler for invalid token', async () => {
    const handler = vi.fn()
    const wrapped = withJwtAuth(handler)
    const request = createNextReq('bad-token')
    await expect(wrapped(request)).rejects.toThrow(AuthenticationError)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('getUserIdFromRequest', () => {
  it('returns userId from jwt payload', () => {
    const request = {
      jwt: { payload: { userId: 'u123' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(getUserIdFromRequest(request)).toBe('u123')
  })

  it('throws AuthenticationError if not authenticated', () => {
    const request = {} as unknown as AuthenticatedRequest
    expect(() => getUserIdFromRequest(request)).toThrow(AuthenticationError)
  })
})

describe('getClaimFromRequest', () => {
  it('returns claim value', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'ADMIN' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(getClaimFromRequest(request, 'role')).toBe('ADMIN')
  })

  it('throws AuthenticationError if not authenticated', () => {
    const request = {} as unknown as AuthenticatedRequest
    expect(() => getClaimFromRequest(request, 'role')).toThrow(AuthenticationError)
  })
})

describe('hasClaim', () => {
  it('returns true when claim exists', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'ADMIN' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasClaim(request, 'role')).toBe(true)
  })

  it('returns true when claim matches expected value', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'ADMIN' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasClaim(request, 'role', 'ADMIN')).toBe(true)
  })

  it('returns false when claim does not match expected value', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'USER' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasClaim(request, 'role', 'ADMIN')).toBe(false)
  })

  it('returns false when claim does not exist', () => {
    const request = {
      jwt: { payload: { userId: 'u1' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasClaim(request, 'nonexistent')).toBe(false)
  })

  it('returns false when request is not authenticated', () => {
    const request = {} as unknown as AuthenticatedRequest
    expect(hasClaim(request, 'role')).toBe(false)
  })
})

describe('getRoleFromRequest', () => {
  it('returns role from jwt payload', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'OPERATOR' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(getRoleFromRequest(request)).toBe(Role.OPERATOR)
  })

  it('falls back to USER for missing role', () => {
    const request = {
      jwt: { payload: { userId: 'u1' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(getRoleFromRequest(request)).toBe(Role.USER)
  })

  it('falls back to USER for invalid role string', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'SUPERADMIN' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(getRoleFromRequest(request)).toBe(Role.USER)
  })

  it('throws AuthenticationError when not authenticated', () => {
    const request = {} as unknown as AuthenticatedRequest
    expect(() => getRoleFromRequest(request)).toThrow(AuthenticationError)
  })
})

describe('hasPermissionFromRequest', () => {
  it('returns true when role has permission', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'ADMIN' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasPermissionFromRequest(request, Permission.SETTINGS_WRITE)).toBe(true)
  })

  it('returns false when role lacks permission', () => {
    const request = {
      jwt: { payload: { userId: 'u1', role: 'USER' }, header: {} },
    } as unknown as AuthenticatedRequest
    expect(hasPermissionFromRequest(request, Permission.SETTINGS_READ)).toBe(false)
  })

  it('returns false when not authenticated', () => {
    const request = {} as unknown as AuthenticatedRequest
    expect(hasPermissionFromRequest(request, Permission.SETTINGS_READ)).toBe(false)
  })
})
