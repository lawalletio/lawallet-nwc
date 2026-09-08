import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Role, Permission } from '@/lib/auth/permissions'

/**
 * End-to-end coverage for the device-token `apiUrl` instance binding against a
 * spoofed client `Host` header.
 *
 * Unlike `unified-auth.test.ts`, this file deliberately does **not** mock
 * `@/lib/public-url` or `@/lib/jwt`: the real `resolveApiUrl()` runs (so its
 * `endpoint` → `Host` fallback path is exercised) and the real
 * `validateJwtFromRequest` verifies a token minted by `mintDeviceToken`. This
 * is the composition the mocked suite misses — a `Host` header driving the
 * comparison on the verify side.
 */

const TEST_SECRET = 'a'.repeat(32)

vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: TEST_SECRET }
  }))
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    nostrIdentity: { findUnique: vi.fn() }
  }
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

import { authenticate } from '@/lib/auth/unified-auth'
import { mintDeviceToken } from '@/lib/auth/device-token'
import { createJwtToken } from '@/lib/jwt'
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

/**
 * Minimal request stub: a `Host` header is a forbidden header on the Fetch
 * `Request`/`Headers` constructors, so an HTTP client's on-the-wire value is
 * modelled with a plain object implementing the only seam the auth code reads.
 */
function bearerRequest(token: string, host: string): Request {
  return {
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'authorization') return `Bearer ${token}`
        if (key === 'host') return host
        return null
      }
    }
  } as unknown as Request
}

function mintDeviceTokenFor(apiUrl: string, role: Role = Role.ADMIN): string {
  return mintDeviceToken({
    pubkey: PUBKEY,
    userId: 'user-1',
    role,
    scopes: [Permission.SETTINGS_WRITE],
    expiresIn: '1h',
    apiUrl,
    secret: TEST_SECRET
  })
}

describe('device-token apiUrl binding — Host-header spoofing (real resolveApiUrl)', () => {
  it('rejects a cross-instance device token when endpoint is unset, even with a matching spoofed Host', async () => {
    // The bug: `endpoint: ''` made resolveApiUrl() return the client Host, so a
    // token minted for https://a.example.com passed on this instance when the
    // attacker sent `Host: a.example.com`. The guard must now fail closed.
    vi.mocked(getSettings).mockResolvedValue({ endpoint: '' })
    const token = mintDeviceTokenFor('https://a.example.com')

    await expect(
      authenticate(bearerRequest(token, 'a.example.com'))
    ).rejects.toThrow(/cannot be verified until .endpoint. is configured/i)
  })

  it('rejects the cross-instance token even when domain is configured but endpoint is not', async () => {
    // 60489928 dropped the domain tier from resolveApiUrl; an unset endpoint
    // must fail closed regardless of a configured lightning-address domain.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: '',
      domain: 'b.example.com'
    })
    const token = mintDeviceTokenFor('https://a.example.com')

    await expect(
      authenticate(bearerRequest(token, 'a.example.com'))
    ).rejects.toThrow(/cannot be verified until .endpoint. is configured/i)
  })

  it('fails closed for every shape of unset endpoint (empty, missing, whitespace)', async () => {
    const token = mintDeviceTokenFor('https://a.example.com')
    for (const endpoint of ['', '   ', '//', undefined]) {
      vi.mocked(getSettings).mockResolvedValue(
        endpoint === undefined ? {} : { endpoint }
      )
      await expect(
        authenticate(bearerRequest(token, 'a.example.com'))
      ).rejects.toThrow(/cannot be verified until .endpoint. is configured/i)
    }
  })

  it('rejects a device token whose apiUrl does not match the configured endpoint', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://b.example.com'
    })
    const token = mintDeviceTokenFor('https://a.example.com')

    await expect(
      authenticate(bearerRequest(token, 'a.example.com'))
    ).rejects.toThrow(/not valid for this instance|apiUrl does not match/i)
  })

  it('accepts a same-instance device token whose apiUrl matches the configured endpoint', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://a.example.com'
    })
    const token = mintDeviceTokenFor('https://a.example.com')

    const auth = await authenticate(bearerRequest(token, 'a.example.com'))
    expect(auth.role).toBe(Role.ADMIN)
    expect(auth.scopes).toContain(Permission.SETTINGS_WRITE)
    expect(auth.method).toBe('jwt')
  })

  it('does not widen access: a non-admin-scoped device token keeps its narrow scopes', async () => {
    // The fix must not change scope handling. A card-only token on a matching
    // instance authenticates but cannot pass a SETTINGS_WRITE gate.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://a.example.com'
    })
    const token = mintDeviceToken({
      pubkey: PUBKEY,
      userId: 'user-1',
      role: Role.OPERATOR,
      scopes: [Permission.CARDS_READ],
      expiresIn: '1h',
      apiUrl: 'https://a.example.com',
      secret: TEST_SECRET
    })

    const auth = await authenticate(bearerRequest(token, 'a.example.com'))
    expect(auth.scopes).toEqual([Permission.CARDS_READ])
    expect(auth.scopes).not.toContain(Permission.SETTINGS_WRITE)
  })

  it('does not affect session JWTs when endpoint is unset', async () => {
    // Session JWTs (no `kind: 'device'`) skip the apiUrl binding entirely, so
    // an unset endpoint must not break them.
    vi.mocked(getSettings).mockResolvedValue({ endpoint: '' })
    const token = createJwtToken(
      { userId: PUBKEY, pubkey: PUBKEY, role: 'USER' },
      TEST_SECRET,
      { expiresIn: '1h', issuer: 'lawallet-nwc', audience: 'lawallet-users' }
    )

    const auth = await authenticate(bearerRequest(token, 'localhost:3000'))
    expect(auth.method).toBe('jwt')
    expect(auth.role).toBe(Role.USER)
    expect(auth.scopes).toBeUndefined()
  })
})
