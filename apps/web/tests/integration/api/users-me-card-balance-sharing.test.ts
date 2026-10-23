import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} }
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

import { PUT } from '@/app/api/users/me/card-balance-sharing/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { eventBus } from '@/lib/events/event-bus'

const PUBKEY = 'a'.repeat(64)
const USER_ID = 'user-1'

function mockOwner() {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as any,
    method: 'nip98'
  })
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: USER_ID, pubkey: PUBKEY, role: 'USER' }
  } as any)
}

function put(body: unknown) {
  return PUT(
    createNextRequest('/api/users/me/card-balance-sharing', {
      method: 'PUT',
      body
    })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)
})

describe('PUT /api/users/me/card-balance-sharing', () => {
  it.each([false, true])('saves enabled=%s for the caller', async enabled => {
    mockOwner()

    const body = await assertResponse(await put({ enabled }), 200)

    expect(body).toEqual({ cardBalanceShared: enabled })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { cardBalanceShared: enabled }
    })
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'users:updated' })
    )
  })

  it('rejects a non-boolean flag (400)', async () => {
    mockOwner()

    const res = await put({ enabled: 'false' })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('401s without authentication', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no'))

    const res = await put({ enabled: false })

    expect(res.status).toBe(401)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})
