import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { Role } from '@/lib/auth/permissions'

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
  RateLimitPresets: {
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 },
  },
}))

vi.mock('@/lib/auth/resolve-role', () => ({
  resolveRole: vi.fn(),
}))

// Inert deps of the real lib/auth/passkey module (resolveRpContext path,
// unused by this route) — mocked so importing the route stays hermetic.
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({})),
}))

vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://app.example.com'),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PASSKEY_SESSION_REFRESHED: 'user.passkey_session_refreshed',
    USER_ERROR: 'user.error',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    SERVER_DATABASE_ERROR: 'server.database_error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
  },
  logActivity: { fireAndForget: vi.fn() },
}))

import { POST } from '@/app/api/auth/passkey/session/refresh/route'
import { getConfig } from '@/lib/config'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { resolveRole } from '@/lib/auth/resolve-role'
import { logActivity } from '@/lib/activity-log'
import { PASSKEY_MAX_SESSION_AGE_SECONDS } from '@/lib/auth/passkey'

const SECRET = 'a'.repeat(48)
const PUBKEY = 'f'.repeat(64)
const CRED_ID = 'credential-abc123'
const USER_ID = 'user_1'

const now = () => Math.floor(Date.now() / 1000)

/** Mints a REAL jwt the way mintPasskeySessionJwt does, so validateJwtFromRequest runs for real. */
function mintToken(
  claims: Record<string, unknown> = {},
  opts: { expiresIn?: string | number } = {}
) {
  return jwt.sign(
    {
      userId: PUBKEY,
      pubkey: PUBKEY,
      role: Role.USER,
      permissions: [],
      amr: ['webauthn'],
      cred: CRED_ID,
      custody: 'linked',
      auth_time: now() - 60,
      ...claims,
    },
    SECRET,
    {
      algorithm: 'HS256',
      expiresIn: (opts.expiresIn ?? '24h') as any,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    }
  )
}

function refreshRequest(token: string) {
  return createNextRequest('/api/auth/passkey/session/refresh', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
}

function mockCredential(overrides: Record<string, unknown> = {}) {
  vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue({
    id: CRED_ID,
    userId: USER_ID,
    user: { id: USER_ID, pubkey: PUBKEY },
    ...overrides,
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getConfig).mockReturnValue({
    jwt: { enabled: true, secret: SECRET },
    maintenance: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    rateLimit: { enabled: false },
    isDevelopment: false,
    isTest: true,
  } as any)
  vi.mocked(resolveRole).mockResolvedValue(Role.USER)
})

describe('POST /api/auth/passkey/session/refresh', () => {
  it('rejects a non-passkey token (no amr) with 401', async () => {
    const token = mintToken({ amr: undefined, cred: undefined, custody: undefined })

    const res = await POST(refreshRequest(token))

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Invalid session for refresh')
    expect(prismaMock.passkeyCredential.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a device token (kind=device) with 401', async () => {
    const token = mintToken({ kind: 'device' })

    const res = await POST(refreshRequest(token))

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Invalid session for refresh')
  })

  it('rejects with 401 when the credential row was deleted (hard revocation)', async () => {
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(null)

    const res = await POST(refreshRequest(mintToken()))

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Session revoked')
  })

  it('rejects with 401 when the credential belongs to a different pubkey', async () => {
    mockCredential({ user: { id: USER_ID, pubkey: 'e'.repeat(64) } })

    const res = await POST(refreshRequest(mintToken()))

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Session revoked')
  })

  it('rejects with 401 when the session is older than the max age cap', async () => {
    mockCredential()
    const staleAuthTime = now() - PASSKEY_MAX_SESSION_AGE_SECONDS - 100
    const token = mintToken({ auth_time: staleAuthTime })

    const res = await POST(refreshRequest(token))

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Session expired — sign in with your passkey again')
  })

  it('rejects an already-expired Bearer with 401 (refresh must happen before expiry)', async () => {
    mockCredential()
    const token = mintToken({}, { expiresIn: '-1h' })

    const res = await POST(refreshRequest(token))

    expect(res.status).toBe(401)
    expect(prismaMock.passkeyCredential.findUnique).not.toHaveBeenCalled()
  })

  it('re-issues a token preserving auth_time, with custody=managed and re-resolved role', async () => {
    mockCredential()
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue({
      userId: USER_ID,
    } as any)
    vi.mocked(resolveRole).mockResolvedValue(Role.OPERATOR)

    const originalAuthTime = now() - 3600
    // Old token says USER — the refresh must re-resolve, not trust the claim.
    const oldToken = mintToken({ auth_time: originalAuthTime, role: Role.USER })

    const res = await POST(refreshRequest(oldToken))
    const body: any = await assertResponse(res, 200)

    expect(body.type).toBe('Bearer')
    expect(body.expiresIn).toBe('24h')
    expect(body.pubkey).toBe(PUBKEY)
    expect(body.custody).toBe('managed')

    const decoded = jwt.verify(body.token, SECRET, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    }) as any
    expect(decoded.auth_time).toBe(originalAuthTime) // SAME auth_time preserved
    expect(decoded.role).toBe(Role.OPERATOR) // from resolveRole, not the old claim
    expect(decoded.custody).toBe('managed')
    expect(decoded.amr).toEqual(['webauthn'])
    expect(decoded.cred).toBe(CRED_ID)
    expect(decoded.pubkey).toBe(PUBKEY)

    // Rate limited per-pubkey after claim inspection.
    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identifier: `passkey-refresh:${PUBKEY}` })
    )

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_session_refreshed',
        userId: USER_ID,
        metadata: { credentialId: CRED_ID },
      })
    )
  })

  it('derives custody=linked when the user has no managed key', async () => {
    mockCredential()
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const res = await POST(refreshRequest(mintToken({ custody: 'managed' })))
    const body: any = await assertResponse(res, 200)

    expect(body.custody).toBe('linked')
    const decoded = jwt.verify(body.token, SECRET, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    }) as any
    // Custody is re-derived from the DB, not copied from the old token.
    expect(decoded.custody).toBe('linked')
  })

  it('falls back to iat as auth_time when the claim is missing', async () => {
    mockCredential()
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const token = mintToken({ auth_time: undefined })
    const iat = (jwt.decode(token) as any).iat

    const res = await POST(refreshRequest(token))
    const body: any = await assertResponse(res, 200)

    const decoded = jwt.verify(body.token, SECRET, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    }) as any
    expect(decoded.auth_time).toBe(iat)
  })

  it('returns 500 when JWT is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const res = await POST(refreshRequest(mintToken()))

    expect(res.status).toBe(500)
  })
})
