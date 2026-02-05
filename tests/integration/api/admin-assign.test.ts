import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'

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

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

import { GET, POST } from '@/app/api/admin/assign/route'
import { validateNip98Auth } from '@/lib/admin-auth'
import { createNewUser } from '@/lib/user'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('POST /api/admin/assign', () => {
  it('assigns root when no root exists', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)

    const user = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.$transaction).mockResolvedValue([{}, {}] as any)

    const req = createNextRequest('/api/admin/assign', { method: 'POST' })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      message: 'Root role assigned successfully',
      pubkey: mockPubkey,
      userId: user.id,
      isFirstRoot: true,
    })
  })

  it('returns already root when user is already root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const user = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)

    const req = createNextRequest('/api/admin/assign', { method: 'POST' })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      message: 'User is already the root',
      pubkey: mockPubkey,
    })
  })

  it('rejects non-root user when root exists', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/admin/assign', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it('creates user if not existing', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const newUser = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(createNewUser).mockResolvedValue(newUser as any)
    vi.mocked(prismaMock.$transaction).mockResolvedValue([{}, {}] as any)

    const req = createNextRequest('/api/admin/assign', { method: 'POST' })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(mockPubkey)
    expect(body).toMatchObject({ userId: newUser.id })
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/admin/assign', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/admin/assign', () => {
  it('returns isRoot true when caller is root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/admin/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: true,
      pubkey: mockPubkey,
      hasRoot: true,
      canAssignRoot: true,
    })
  })

  it('returns canAssignRoot true when no root exists', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/admin/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: null,
      pubkey: mockPubkey,
      hasRoot: false,
      canAssignRoot: true,
    })
  })

  it('returns canAssignRoot false for non-root when root exists', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/admin/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: false,
      pubkey: otherPubkey,
      hasRoot: true,
      canAssignRoot: false,
    })
  })
})
