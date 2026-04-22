import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture, createAdminUserFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
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

// Route now uses unified `authenticate()` so the dashboard's JWT is accepted
// alongside NIP-98. The AuthResult already carries role+pubkey, so there's
// no separate caller-role DB lookup to mock anymore.
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

import { GET, PUT } from '@/app/api/users/[userId]/role/route'
import { authenticate } from '@/lib/auth/unified-auth'

const adminPubkey = 'a'.repeat(64)
const userPubkey = 'b'.repeat(64)

const mockAuth = (role: Role, pubkey: string) =>
  vi.mocked(authenticate).mockResolvedValue({ role, pubkey, method: 'jwt' })

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users/[userId]/role', () => {
  it('allows user to view their own role', async () => {
    const user = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    mockAuth(Role.USER, userPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)

    const req = createNextRequest(`/api/users/${user.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: user.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: user.id, role: 'USER' })
  })

  it('allows admin to view any user role', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'VIEWER' })
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(target as any)

    const req = createNextRequest(`/api/users/${target.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: target.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: target.id, role: 'VIEWER' })
  })

  it('rejects non-admin viewing another user role', async () => {
    const target = createUserFixture({ pubkey: 'c'.repeat(64), role: 'USER' })
    mockAuth(Role.USER, userPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(target as any)

    const req = createNextRequest(`/api/users/${target.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/role')
    const res = await GET(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/users/[userId]/role', () => {
  it('allows admin to promote user to OPERATOR', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(target as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({
      id: target.id,
      role: 'OPERATOR',
    } as any)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'OPERATOR' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: target.id, role: 'OPERATOR' })
  })

  it('allows admin to demote user to USER', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'OPERATOR' })
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(target as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({
      id: target.id,
      role: 'USER',
    } as any)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'USER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: target.id, role: 'USER' })
  })

  it('rejects non-admin from managing roles', async () => {
    const target = createUserFixture({ pubkey: 'c'.repeat(64), role: 'USER' })
    mockAuth(Role.USER, userPubkey)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'OPERATOR' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('prevents assigning role equal to or higher than own', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    // OPERATOR has USERS_MANAGE_ROLES? No — only ADMIN does per the permissions
    // matrix. Use ADMIN here and try to assign ADMIN (equal rank).
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(target as any)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'ADMIN' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('prevents self-demotion', async () => {
    const admin = createAdminUserFixture({ pubkey: adminPubkey })
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(admin as any)

    const req = createNextRequest(`/api/users/${admin.id}/role`, {
      method: 'PUT',
      body: { role: 'USER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: admin.id }))

    expect(res.status).toBe(403)
  })

  it('prevents removing last admin', async () => {
    const target = createAdminUserFixture({ pubkey: userPubkey })
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: target.id,
      role: 'ADMIN',
      pubkey: userPubkey,
    } as any)
    vi.mocked(prismaMock.user.count).mockResolvedValue(1)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'VIEWER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))
    const body: any = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toBe('Cannot remove the last admin')
  })

  it('returns 404 for nonexistent target user', async () => {
    mockAuth(Role.ADMIN, adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/some-user-id/role', {
      method: 'PUT',
      body: { role: 'VIEWER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-user-id' }))

    expect(res.status).toBe(404)
  })

  it('rejects invalid role value', async () => {
    mockAuth(Role.ADMIN, adminPubkey)

    const req = createNextRequest('/api/users/some-id/role', {
      method: 'PUT',
      body: { role: 'SUPERADMIN' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })
})
