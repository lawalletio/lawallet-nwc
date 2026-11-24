import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Role, Permission } from '@/lib/auth/permissions'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'

// Mock dependencies
vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn()
}))

vi.mock('@/lib/jwt', () => ({
  validateJwtFromRequest: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: 'a'.repeat(32) }
  }))
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    },
    // Account resolution (lib/auth/account) checks NostrIdentity first and
    // falls back to User.pubkey — the tests mock only the User fallback.
    nostrIdentity: {
      findUnique: vi.fn()
    }
  }
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://app.example.com')
}))

import {
  authenticate,
  authenticateWithRole,
  authenticateWithPermission
} from '@/lib/auth/unified-auth'
import { validateNip98 } from '@/lib/nip98'
import { validateJwtFromRequest } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { resolveApiUrl } from '@/lib/public-url'

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
    headers: { Authorization: 'Nostr dGVzdA==' }
  })
}

function mockBearerRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer valid-jwt-token' }
  })
}

function mockNoAuthRequest(url = 'http://localhost:3000/api/test') {
  return new Request(url, { method: 'GET' })
}

describe('authenticate', () => {
  describe('with NIP-98 (Nostr header)', () => {
    it('returns pubkey and role from DB', async () => {
      vi.mocked(validateNip98).mockResolvedValue({
        pubkey: PUBKEY,
        event: {} as any
      })
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        role: 'OPERATOR'
      } as any)
      vi.mocked(getSettings).mockResolvedValue({})

      const result = await authenticate(mockNostrRequest())
      expect(result.pubkey).toBe(PUBKEY)
      expect(result.role).toBe(Role.OPERATOR)
      expect(result.method).toBe('nip98')
    })

    it('falls back to Settings root for admin', async () => {
      vi.mocked(validateNip98).mockResolvedValue({
        pubkey: PUBKEY,
        event: {} as any
      })
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        role: 'USER'
      } as any)
      vi.mocked(getSettings).mockResolvedValue({ root: PUBKEY })

      const result = await authenticate(mockNostrRequest())
      expect(result.role).toBe(Role.ADMIN)
      expect(result.method).toBe('nip98')
    })

    it('throws AuthenticationError on invalid NIP-98', async () => {
      vi.mocked(validateNip98).mockRejectedValue(new Error('bad event'))

      await expect(authenticate(mockNostrRequest())).rejects.toThrow(
        AuthenticationError
      )
    })
  })

  describe('with JWT (Bearer header)', () => {
    beforeEach(() => {
      // Session JWTs re-resolve the role from the DB on every request, so
      // default to "no account, no root" and let each test opt into a role.
      // (clearAllMocks keeps stale mockResolvedValue implementations — set
      // them explicitly or a previous describe's role leaks into this one.)
      vi.mocked(prisma.nostrIdentity.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(getSettings).mockResolvedValue({})
    })

    it('re-resolves a session JWT role from the DB instead of trusting the claim', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' }
      } as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        pubkey: PUBKEY,
        role: 'OPERATOR'
      } as any)

      const result = await authenticate(mockBearerRequest())
      expect(result.pubkey).toBe(PUBKEY)
      // The claim says ADMIN, the DB says OPERATOR — the DB wins.
      expect(result.role).toBe(Role.OPERATOR)
      expect(result.method).toBe('jwt')
    })

    it('a demoted admin loses privileges immediately, even with a live token', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' }
      } as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        pubkey: PUBKEY,
        role: 'USER'
      } as any)
      vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

      const result = await authenticate(mockBearerRequest())
      expect(result.role).toBe(Role.USER)
      await expect(
        authenticateWithPermission(
          mockBearerRequest(),
          Permission.SETTINGS_WRITE
        )
      ).rejects.toThrow(AuthorizationError)
    })

    it('falls back to the Settings root for admin on a session JWT', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'USER', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' }
      } as any)
      vi.mocked(getSettings).mockResolvedValue({ root: PUBKEY })

      const result = await authenticate(mockBearerRequest())
      expect(result.role).toBe(Role.ADMIN)
    })

    it('falls back to USER when JWT has invalid role', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { pubkey: PUBKEY, role: 'INVALID', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' }
      } as any)

      const result = await authenticate(mockBearerRequest())
      expect(result.role).toBe(Role.USER)
    })

    it('throws AuthenticationError when JWT missing pubkey', async () => {
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: { role: 'ADMIN', iat: 1000, exp: 2000 },
        header: { alg: 'HS256' }
      } as any)

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(
        AuthenticationError
      )
    })

    it('throws AuthenticationError on invalid JWT', async () => {
      vi.mocked(validateJwtFromRequest).mockRejectedValue(new Error('invalid'))

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(
        AuthenticationError
      )
    })

    it('throws AuthenticationError when JWT not configured', async () => {
      vi.mocked(getConfig).mockReturnValue({
        jwt: { enabled: false, secret: undefined }
      } as any)

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(
        AuthenticationError
      )
    })
  })

  describe('without auth header', () => {
    it('throws AuthenticationError', async () => {
      await expect(authenticate(mockNoAuthRequest())).rejects.toThrow(
        AuthenticationError
      )
    })
  })

  describe('with unsupported auth scheme', () => {
    it('throws AuthenticationError', async () => {
      const request = new Request('http://localhost:3000/api/test', {
        headers: { Authorization: 'Basic abc123' }
      })
      await expect(authenticate(request)).rejects.toThrow(AuthenticationError)
    })
  })
})

describe('authenticateWithRole', () => {
  it('passes when role is sufficient', async () => {
    vi.mocked(validateNip98).mockResolvedValue({
      pubkey: PUBKEY,
      event: {} as any
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: 'ADMIN'
    } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticateWithRole(mockNostrRequest(), Role.ADMIN)
    expect(result.pubkey).toBe(PUBKEY)
  })

  it('throws AuthorizationError when role is insufficient', async () => {
    vi.mocked(validateNip98).mockResolvedValue({
      pubkey: PUBKEY,
      event: {} as any
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      authenticateWithRole(mockNostrRequest(), Role.ADMIN)
    ).rejects.toThrow(AuthorizationError)
  })

  it('works with JWT auth too', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'a'.repeat(32) }
    } as any)
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
      header: { alg: 'HS256' }
    } as any)
    // Session JWT: the role gate reads the DB role, not the claim.
    vi.mocked(prisma.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: PUBKEY,
      role: 'ADMIN'
    } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticateWithRole(mockBearerRequest(), Role.ADMIN)
    expect(result.pubkey).toBe(PUBKEY)
    expect(result.method).toBe('jwt')
  })
})

describe('authenticateWithPermission', () => {
  it('passes when role has the permission', async () => {
    vi.mocked(validateNip98).mockResolvedValue({
      pubkey: PUBKEY,
      event: {} as any
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: 'ADMIN'
    } as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticateWithPermission(
      mockNostrRequest(),
      Permission.SETTINGS_WRITE
    )
    expect(result.pubkey).toBe(PUBKEY)
  })

  it('throws AuthorizationError when permission is denied', async () => {
    vi.mocked(validateNip98).mockResolvedValue({
      pubkey: PUBKEY,
      event: {} as any
    })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: 'USER' } as any)
    vi.mocked(getSettings).mockResolvedValue({ root: 'different' })

    await expect(
      authenticateWithPermission(mockNostrRequest(), Permission.SETTINGS_WRITE)
    ).rejects.toThrow(AuthorizationError)
  })
})

describe('device-token scopes (B.0)', () => {
  function mockDeviceToken(role: string, scopes: unknown, dbRole = role) {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'a'.repeat(32) }
    } as any)
    // The device-token branch reads `endpoint` to fail closed when it's
    // unset (see the apiUrl guard). Pin a configured endpoint matching the
    // token's apiUrl so the scopes-focused tests stay decoupled from the
    // binding check.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://app.example.com'
    })
    // The owner's role today, which caps the token's minted role.
    vi.mocked(prisma.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: PUBKEY,
      role: dbRole
    } as any)
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        pubkey: PUBKEY,
        role,
        scopes,
        // kind: 'device' + matching apiUrl mark this as a device token.
        kind: 'device',
        apiUrl: 'https://app.example.com',
        iat: 1000,
        exp: 2000
      },
      header: { alg: 'HS256' }
    } as any)
  }

  const allowDevice = { allowDeviceToken: true }

  it('is refused by plain authenticate() — owner routes never accept it', async () => {
    mockDeviceToken('ADMIN', ['cards:read'])

    await expect(authenticate(mockBearerRequest())).rejects.toThrow(
      AuthorizationError
    )
  })

  it('is refused by authenticateWithRole even when the role would pass', async () => {
    // A role gate says nothing about which permissions were delegated: an
    // ADMIN's cards-only token must not reach admin-role routes (backups).
    mockDeviceToken('ADMIN', ['cards:read'])

    await expect(
      authenticateWithRole(mockBearerRequest(), Role.ADMIN)
    ).rejects.toThrow(AuthorizationError)
  })

  it('caps the minted role at the owner role in the DB', async () => {
    mockDeviceToken('ADMIN', ['cards:read'], 'OPERATOR')
    const demoted = await authenticate(mockBearerRequest(), allowDevice)
    expect(demoted.role).toBe(Role.OPERATOR)
    expect(demoted.deviceToken).toBe(true)

    // …and never raises it: a later promotion doesn't widen the token.
    mockDeviceToken('OPERATOR', ['cards:read'], 'ADMIN')
    const promoted = await authenticate(mockBearerRequest(), allowDevice)
    expect(promoted.role).toBe(Role.OPERATOR)
  })

  it('surfaces a valid scopes array on the AuthResult', async () => {
    mockDeviceToken('OPERATOR', ['cards:read', 'cards:write'])

    const result = await authenticate(mockBearerRequest(), allowDevice)
    expect(result.scopes).toEqual([
      Permission.CARDS_READ,
      Permission.CARDS_WRITE
    ])
  })

  it('narrows permission checks to the scopes claim', async () => {
    mockDeviceToken('ADMIN', ['cards:read'])

    // In scope → allowed
    await expect(
      authenticateWithPermission(mockBearerRequest(), Permission.CARDS_READ)
    ).resolves.toMatchObject({ pubkey: PUBKEY })

    // Out of scope → denied even though ADMIN would normally hold it
    await expect(
      authenticateWithPermission(mockBearerRequest(), Permission.SETTINGS_WRITE)
    ).rejects.toThrow(AuthorizationError)
  })

  it('grants a delegated scope beyond the base role (override, not intersection)', async () => {
    // A USER-role identity normally holds zero permissions, but the admin
    // explicitly delegated cards:write — the scope claim wins.
    mockDeviceToken('USER', ['cards:write'])

    await expect(
      authenticateWithPermission(mockBearerRequest(), Permission.CARDS_WRITE)
    ).resolves.toMatchObject({ pubkey: PUBKEY })
  })

  it('treats a malformed scopes claim as no permissions, never the role map', async () => {
    // Not an array → nothing is delegated, even though the role is ADMIN.
    mockDeviceToken('ADMIN', 'cards:read')

    const result = await authenticate(mockBearerRequest(), allowDevice)
    expect(result.scopes).toEqual([])
    await expect(
      authenticateWithPermission(mockBearerRequest(), Permission.SETTINGS_WRITE)
    ).rejects.toThrow(AuthorizationError)
  })

  it('drops unknown scope strings so a bad claim cannot widen access', async () => {
    mockDeviceToken('ADMIN', ['cards:read', 'not:a:permission'])

    const result = await authenticate(mockBearerRequest(), allowDevice)
    expect(result.scopes).toEqual([Permission.CARDS_READ])
  })
})

describe('single-purpose JWTs are not API credentials', () => {
  it.each(['merge-ticket', 'link-challenge', 'something-else'])(
    'rejects a token of kind %s',
    async kind => {
      vi.mocked(getConfig).mockReturnValue({
        jwt: { enabled: true, secret: 'a'.repeat(32) }
      } as any)
      vi.mocked(validateJwtFromRequest).mockResolvedValue({
        payload: {
          userId: 'attacker-account',
          pubkey: PUBKEY,
          kind,
          iat: 1000,
          exp: 2000
        },
        header: { alg: 'HS256' }
      } as any)

      await expect(authenticate(mockBearerRequest())).rejects.toThrow(
        AuthenticationError
      )
    }
  )
})

describe('device-token apiUrl enforcement (B.0)', () => {
  function mockDeviceTokenWithApiUrl(apiUrl: unknown) {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'a'.repeat(32) }
    } as any)
    // Pin a configured endpoint so the fail-closed guard (which rejects
    // device tokens when `endpoint` is unset) doesn't fire and these tests
    // exercise the apiUrl comparison itself.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://app.example.com'
    })
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        pubkey: PUBKEY,
        role: 'OPERATOR',
        kind: 'device',
        apiUrl,
        iat: 1000,
        exp: 2000
      },
      header: { alg: 'HS256' }
    } as any)
  }

  it('authenticates when apiUrl matches the serving instance', async () => {
    mockDeviceTokenWithApiUrl('https://app.example.com')

    const result = await authenticate(mockBearerRequest(), {
      allowDeviceToken: true
    })
    expect(result.pubkey).toBe(PUBKEY)
    expect(result.method).toBe('jwt')
  })

  it('matches despite trailing slash and case differences', async () => {
    mockDeviceTokenWithApiUrl('https://app.example.com/')

    await expect(
      authenticate(mockBearerRequest(), { allowDeviceToken: true })
    ).resolves.toMatchObject({
      pubkey: PUBKEY
    })
  })

  it('rejects a device token whose apiUrl is for another instance', async () => {
    mockDeviceTokenWithApiUrl('https://other.example.com')

    await expect(authenticate(mockBearerRequest())).rejects.toThrow(
      AuthenticationError
    )
  })

  it('rejects a device token missing the apiUrl claim', async () => {
    mockDeviceTokenWithApiUrl(undefined)

    await expect(authenticate(mockBearerRequest())).rejects.toThrow(
      AuthenticationError
    )
  })

  it('fails closed when endpoint is unset, ignoring the client Host', async () => {
    // Regression guard for the Host-header spoofing bypass: with `endpoint`
    // unset, resolveApiUrl() would return the client Host, making the
    // apiUrl comparison vacuous. The guard now rejects before consulting it.
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: 'a'.repeat(32) }
    } as any)
    vi.mocked(getSettings).mockResolvedValue({ endpoint: '' })
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: {
        pubkey: PUBKEY,
        role: 'ADMIN',
        kind: 'device',
        apiUrl: 'https://app.example.com',
        scopes: [Permission.SETTINGS_WRITE],
        iat: 1000,
        exp: 2000
      },
      header: { alg: 'HS256' }
    } as any)

    await expect(authenticate(mockBearerRequest())).rejects.toThrow(
      AuthenticationError
    )
    // Crucially, resolveApiUrl is never reached, so the spoofed Host never
    // feeds the comparison.
    expect(resolveApiUrl).not.toHaveBeenCalled()
  })

  it('does not enforce apiUrl on a session JWT (no kind claim)', async () => {
    vi.mocked(validateJwtFromRequest).mockResolvedValue({
      payload: { pubkey: PUBKEY, role: 'ADMIN', iat: 1000, exp: 2000 },
      header: { alg: 'HS256' }
    } as any)
    // Session JWTs re-resolve the role from the DB — pin it explicitly.
    vi.mocked(prisma.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({})

    const result = await authenticate(mockBearerRequest())
    expect(result.pubkey).toBe(PUBKEY)
    expect(result.role).toBe(Role.USER)
    expect(resolveApiUrl).not.toHaveBeenCalled()
  })
})
