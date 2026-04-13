import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'

// Mock dependencies
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

import { GET, POST } from '@/app/api/root/assign/route'
import { validateNip98Auth } from '@/lib/admin-auth'
import { createNewUser } from '@/lib/user'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('POST /api/root/assign', () => {
  it('assigns root when no root exists and user exists', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)

    const user = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)

    const req = createNextRequest('/api/root/assign', { method: 'POST' })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      message: 'Root role assigned successfully',
      pubkey: mockPubkey,
      userId: user.id,
    })
  })

  it('creates user if not existing, then assigns root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const newUser = createUserFixture({ pubkey: mockPubkey })
    vi.mocked(createNewUser).mockResolvedValue(newUser as any)

    const req = createNextRequest('/api/root/assign', { method: 'POST' })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(mockPubkey)
    expect(body).toMatchObject({
      message: 'Root role assigned successfully',
      pubkey: mockPubkey,
      userId: newUser.id,
    })
  })

  it('rejects when root already exists', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/root/assign', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/root/assign', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/root/assign', () => {
  it('returns isRoot true when caller is root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/root/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: true,
      pubkey: mockPubkey,
      hasRoot: true,
      canAssignRoot: false,
    })
  })

  it('returns canAssignRoot true when no root exists', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/root/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: null,
      pubkey: mockPubkey,
      hasRoot: false,
      canAssignRoot: true,
    })
  })

  it('returns isRoot false when caller is not root', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
      name: 'root',
      value: mockPubkey,
    } as any)

    const req = createNextRequest('/api/root/assign')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      isRoot: false,
      pubkey: otherPubkey,
      hasRoot: true,
      canAssignRoot: false,
    })
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/root/assign')
    const res = await GET(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
