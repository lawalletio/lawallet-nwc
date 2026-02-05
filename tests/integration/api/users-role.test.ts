import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture, createAdminUserFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

vi.mock('@/lib/admin-auth', () => ({
  validateNip98Auth: vi.fn(),
}))

import { GET, PUT } from '@/app/api/users/[userId]/role/route'
import { validateNip98Auth } from '@/lib/admin-auth'

const adminPubkey = 'a'.repeat(64)
const userPubkey = 'b'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users/[userId]/role', () => {
  it('allows user to view their own role', async () => {
    const user = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    vi.mocked(validateNip98Auth).mockResolvedValue(userPubkey)
    // First call: find target user; second call: find caller for resolveCallerRole
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce(user as any) // target user
      .mockResolvedValueOnce({ role: 'USER' } as any) // caller role

    const req = createNextRequest(`/api/users/${user.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: user.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: user.id, role: 'USER' })
  })

  it('allows admin to view any user role', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'VIEWER' })
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce(target as any)
      .mockResolvedValueOnce({ role: 'ADMIN' } as any)

    const req = createNextRequest(`/api/users/${target.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: target.id }))
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ userId: target.id, role: 'VIEWER' })
  })

  it('rejects non-admin viewing another user role', async () => {
    const target = createUserFixture({ pubkey: 'c'.repeat(64), role: 'USER' })
    vi.mocked(validateNip98Auth).mockResolvedValue(userPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce(target as any)
      .mockResolvedValueOnce({ role: 'USER' } as any)

    const req = createNextRequest(`/api/users/${target.id}/role`)
    const res = await GET(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/role')
    const res = await GET(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/users/[userId]/role', () => {
  it('allows admin to promote user to OPERATOR', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'ADMIN' } as any) // caller
      .mockResolvedValueOnce(target as any) // target
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
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'ADMIN' } as any)
      .mockResolvedValueOnce(target as any)
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
    vi.mocked(validateNip98Auth).mockResolvedValue(userPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ role: 'USER' } as any)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'OPERATOR' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('prevents assigning role equal to or higher than own', async () => {
    const target = createUserFixture({ pubkey: userPubkey, role: 'USER' })
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'OPERATOR' } as any) // caller is OPERATOR
      .mockResolvedValueOnce(target as any)

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'ADMIN' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))

    expect(res.status).toBe(403)
  })

  it('prevents self-demotion', async () => {
    const admin = createAdminUserFixture({ pubkey: adminPubkey })
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'ADMIN' } as any)
      .mockResolvedValueOnce(admin as any)

    const req = createNextRequest(`/api/users/${admin.id}/role`, {
      method: 'PUT',
      body: { role: 'USER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: admin.id }))

    expect(res.status).toBe(403)
  })

  it('prevents removing last admin', async () => {
    const target = createAdminUserFixture({ pubkey: userPubkey })
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'ADMIN', pubkey: adminPubkey } as any) // caller
      .mockResolvedValueOnce({ id: target.id, role: 'ADMIN', pubkey: userPubkey } as any) // target is different ADMIN
    vi.mocked(prismaMock.user.count).mockResolvedValue(1) // only 1 admin

    const req = createNextRequest(`/api/users/${target.id}/role`, {
      method: 'PUT',
      body: { role: 'VIEWER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: target.id }))
    const body: any = await res.json()

    // Route checks hierarchy: ADMIN cannot assign VIEWER (equal rank - fails)
    // The hierarchy check: getRoleLevel(ADMIN)=3 <= getRoleLevel(VIEWER)=1 is false, so passes
    // Self-demotion: target.pubkey !== caller.pubkey, so passes
    // Last admin: target.role ADMIN, targetRole VIEWER, count=1 → error
    expect(res.status).toBe(400)
    expect(body.error.message).toBe('Cannot remove the last admin')
  })

  it('returns 404 for nonexistent target user', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique)
      .mockResolvedValueOnce({ role: 'ADMIN', pubkey: adminPubkey } as any) // caller
      .mockResolvedValueOnce(null) // target doesn't exist

    const req = createNextRequest('/api/users/some-user-id/role', {
      method: 'PUT',
      body: { role: 'VIEWER' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-user-id' }))

    expect(res.status).toBe(404)
  })

  it('rejects invalid role value', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(adminPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ role: 'ADMIN' } as any)

    const req = createNextRequest('/api/users/some-id/role', {
      method: 'PUT',
      body: { role: 'SUPERADMIN' },
    })
    const res = await PUT(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBe(400)
  })
})
