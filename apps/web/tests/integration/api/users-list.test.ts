import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

import { GET } from '@/app/api/users/route'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users', () => {
  it('selects only the columns the list renders and keeps the row shape', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z')
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      {
        id: 'u1',
        pubkey: 'pk1',
        role: 'USER',
        createdAt,
        lightningAddresses: [{ username: 'alice' }],
        _count: { lightningAddresses: 2, remoteWallets: 1 }
      },
      {
        id: 'u2',
        pubkey: 'pk2',
        role: 'ADMIN',
        createdAt,
        lightningAddresses: [],
        _count: { lightningAddresses: 0, remoteWallets: 0 }
      }
    ] as any)

    const res = await GET(createNextRequest('/api/users'))
    const body = await assertResponse(res, 200)

    const args = vi.mocked(prismaMock.user.findMany).mock.calls[0][0] as any
    expect(args.include).toBeUndefined()
    expect(Object.keys(args.select)).toEqual([
      'id',
      'pubkey',
      'role',
      'createdAt',
      'lightningAddresses',
      '_count'
    ])
    expect(body).toEqual([
      {
        id: 'u1',
        pubkey: 'pk1',
        role: 'USER',
        createdAt: createdAt.toISOString(),
        primaryAddress: 'alice',
        addressCount: 2,
        hasNwc: true
      },
      {
        id: 'u2',
        pubkey: 'pk2',
        role: 'ADMIN',
        createdAt: createdAt.toISOString(),
        primaryAddress: null,
        addressCount: 0,
        hasNwc: false
      }
    ])
  })
})
