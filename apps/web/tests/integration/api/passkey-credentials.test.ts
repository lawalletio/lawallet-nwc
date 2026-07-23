import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    keyVault: { secret: 'b'.repeat(48), previousSecrets: [], enabled: true },
    maintenance: { enabled: false },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    isDevelopment: false,
    isTest: true,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    public: {},
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 },
  },
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PASSKEY_RENAMED: 'user.passkey_renamed',
    PASSKEY_DELETED: 'user.passkey_deleted',
  },
  logActivity: { fireAndForget: vi.fn() },
}))

import { GET } from '@/app/api/auth/passkey/credentials/route'
import { PATCH, DELETE } from '@/app/api/auth/passkey/credentials/[id]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logActivity } from '@/lib/activity-log'
import { Role } from '@/lib/auth/permissions'

const PUBKEY = 'a'.repeat(64)

const mockUser = () =>
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: Role.USER,
    method: 'jwt',
  })

// PasskeyCredential row factory — base64url ids (contain '-' and '_'),
// Bytes publicKey, BigInt counter, exactly like the Prisma model.
function makeCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-AbC_123-xyz',
    userId: 'user-1',
    publicKey: Buffer.from('secret-public-key-bytes'),
    counter: BigInt(42),
    transports: '["internal"]',
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: null,
    label: 'MacBook Touch ID',
    rpId: 'localhost',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    ...overrides,
  }
}

const makeManagedKey = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  ciphertext: Buffer.from('encrypted'),
  exportedAt: null,
  ...overrides,
})

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user-1',
  } as any)
})

describe('GET /api/auth/passkey/credentials', () => {
  it('returns summaries only — never publicKey or counter', async () => {
    mockUser()
    const rows = [
      makeCredential(),
      makeCredential({ id: 'cred-second_-id', label: null, lastUsedAt: new Date('2026-02-01T00:00:00.000Z') }),
    ]
    vi.mocked(prismaMock.passkeyCredential.findMany).mockResolvedValue(rows as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      makeManagedKey() as any
    )

    const res = await GET(createNextRequest('/api/auth/passkey/credentials'))
    const body: any = await assertResponse(res, 200)

    expect(body.credentials).toHaveLength(2)
    expect(body.hasManagedKey).toBe(true)
    // Managed key present but never exported.
    expect(body.managedKeyExported).toBe(false)
    for (const cred of body.credentials) {
      expect(cred).not.toHaveProperty('publicKey')
      expect(cred).not.toHaveProperty('counter')
      expect(cred).toHaveProperty('id')
      expect(cred).toHaveProperty('deviceType')
    }
    expect(body.credentials[0]).toMatchObject({
      id: 'cred-AbC_123-xyz',
      label: 'MacBook Touch ID',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
    })
    expect(body.credentials[1].lastUsedAt).toBe('2026-02-01T00:00:00.000Z')
    // Only the user's own credentials, oldest first.
    expect(prismaMock.passkeyCredential.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('reports hasManagedKey false for linked accounts', async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const res = await GET(createNextRequest('/api/auth/passkey/credentials'))
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      credentials: [],
      hasManagedKey: false,
      managedKeyExported: false,
    })
  })

  it('reports managedKeyExported true once the key has been exported', async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findMany).mockResolvedValue([
      makeCredential(),
    ] as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      makeManagedKey({ exportedAt: new Date('2026-03-01T00:00:00.000Z') }) as any
    )

    const res = await GET(createNextRequest('/api/auth/passkey/credentials'))
    const body: any = await assertResponse(res, 200)

    expect(body.hasManagedKey).toBe(true)
    expect(body.managedKeyExported).toBe(true)
  })

  it('returns 404 when the user row is missing', async () => {
    mockUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const res = await GET(createNextRequest('/api/auth/passkey/credentials'))

    expect(res.status).toBe(404)
  })

  it('rejects unauthenticated callers', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('unauthorized'))

    const res = await GET(createNextRequest('/api/auth/passkey/credentials'))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

function patchReq(id: string, body: unknown) {
  return createNextRequest(`/api/auth/passkey/credentials/${id}`, {
    method: 'PATCH',
    body: body as Record<string, unknown>,
  })
}

function deleteReq(id: string) {
  return createNextRequest(`/api/auth/passkey/credentials/${id}`, {
    method: 'DELETE',
  })
}

describe('PATCH /api/auth/passkey/credentials/[id]', () => {
  it('renames the passkey and logs PASSKEY_RENAMED', async () => {
    mockUser()
    const credential = makeCredential()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credential as any
    )
    vi.mocked(prismaMock.passkeyCredential.update).mockResolvedValue({
      ...credential,
      label: 'Work laptop',
    } as any)

    const res = await PATCH(
      patchReq(credential.id, { label: 'Work laptop' }),
      createParamsPromise({ id: credential.id })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.credential.label).toBe('Work laptop')
    expect(body.credential).not.toHaveProperty('publicKey')
    expect(body.credential).not.toHaveProperty('counter')
    expect(prismaMock.passkeyCredential.update).toHaveBeenCalledWith({
      where: { id: credential.id },
      data: { label: 'Work laptop' },
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_renamed',
        userId: 'user-1',
        metadata: { credentialId: credential.id },
      })
    )
  })

  it('returns 404 when the user row is missing', async () => {
    mockUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const res = await PATCH(
      patchReq('cred-AbC_123-xyz', { label: 'x' }),
      createParamsPromise({ id: 'cred-AbC_123-xyz' })
    )

    expect(res.status).toBe(404)
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })

  it("returns 404 (not 403) for another user's credential", async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      makeCredential({ userId: 'user-2' }) as any
    )

    const res = await PATCH(
      patchReq('cred-AbC_123-xyz', { label: 'hijack' }),
      createParamsPromise({ id: 'cred-AbC_123-xyz' })
    )

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })

  it('returns 404 for a nonexistent credential', async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(null)

    const res = await PATCH(
      patchReq('nope', { label: 'x' }),
      createParamsPromise({ id: 'nope' })
    )

    expect(res.status).toBe(404)
  })

  it('rejects an invalid label', async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      makeCredential() as any
    )

    const res = await PATCH(
      patchReq('cred-AbC_123-xyz', { label: '' }),
      createParamsPromise({ id: 'cred-AbC_123-xyz' })
    )

    expect(res.status).toBe(400)
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/auth/passkey/credentials/[id]', () => {
  const setupOwnedCredential = (overrides: Record<string, unknown> = {}) => {
    const credential = makeCredential(overrides)
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credential as any
    )
    vi.mocked(prismaMock.passkeyCredential.delete).mockResolvedValue(
      credential as any
    )
    return credential
  }

  it('deletes any credential — no export guard under the PRF model', async () => {
    mockUser()
    const credential = setupOwnedCredential()

    const res = await DELETE(
      deleteReq(credential.id),
      createParamsPromise({ id: credential.id })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Passkey deleted', id: credential.id })
    expect(prismaMock.passkeyCredential.delete).toHaveBeenCalledWith({
      where: { id: credential.id },
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_deleted',
        metadata: { credentialId: credential.id },
      })
    )
  })

  it('deletes the last credential even when a legacy managed key exists', async () => {
    mockUser()
    const credential = setupOwnedCredential()
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      makeManagedKey({ exportedAt: null }) as any
    )

    const res = await DELETE(
      deleteReq(credential.id),
      createParamsPromise({ id: credential.id })
    )
    await assertResponse(res, 200)
    expect(prismaMock.passkeyCredential.delete).toHaveBeenCalled()
  })

  it('rate-limits per user with the sensitive preset', async () => {
    mockUser()
    const credential = setupOwnedCredential()
    vi.mocked(prismaMock.passkeyCredential.count).mockResolvedValue(2)

    await DELETE(
      deleteReq(credential.id),
      createParamsPromise({ id: credential.id })
    )

    expect(rateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxRequests: 5,
        identifier: `passkey-delete:${PUBKEY}`,
      })
    )
  })

  it('returns 404 when the user row is missing', async () => {
    mockUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const res = await DELETE(
      deleteReq('cred-AbC_123-xyz'),
      createParamsPromise({ id: 'cred-AbC_123-xyz' })
    )

    expect(res.status).toBe(404)
    expect(prismaMock.passkeyCredential.delete).not.toHaveBeenCalled()
  })

  it("returns 404 (not 403) for another user's credential", async () => {
    mockUser()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      makeCredential({ userId: 'user-2' }) as any
    )

    const res = await DELETE(
      deleteReq('cred-AbC_123-xyz'),
      createParamsPromise({ id: 'cred-AbC_123-xyz' })
    )

    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(prismaMock.passkeyCredential.delete).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('unauthorized'))

    const res = await DELETE(
      deleteReq('any-id'),
      createParamsPromise({ id: 'any-id' })
    )

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
