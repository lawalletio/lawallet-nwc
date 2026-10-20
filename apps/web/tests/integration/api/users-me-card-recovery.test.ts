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
vi.mock('@/lib/activity-log', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/activity-log')>()),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

import { PUT as SetCardRecovery } from '@/app/api/users/me/card-recovery/route'
import { POST as DismissTransfer } from '@/app/api/users/me/account-transfer/dismiss/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { eventBus } from '@/lib/events/event-bus'
import { logActivity } from '@/lib/activity-log'

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

function mockUnknownPubkey() {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as any,
    method: 'nip98'
  })
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
}

function put(body: unknown) {
  return SetCardRecovery(
    createNextRequest('/api/users/me/card-recovery', { method: 'PUT', body })
  )
}

function dismiss() {
  return DismissTransfer(
    createNextRequest('/api/users/me/account-transfer/dismiss', {
      method: 'POST'
    })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)
})

describe('PUT /api/users/me/card-recovery', () => {
  it('turns recovery off and revokes outstanding RECOVER QRs', async () => {
    mockOwner()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 2
    } as any)

    const body = await assertResponse(await put({ enabled: false }), 200)

    expect(body).toEqual({ cardRecoveryEnabled: false })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { cardRecoveryEnabled: false }
    })
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
      where: {
        purpose: 'RECOVER',
        recoverFromUserId: USER_ID,
        status: 'PENDING'
      },
      data: { status: 'REVOKED' }
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.card_recovery_setting_changed',
        level: 'WARN',
        userId: USER_ID,
        metadata: { enabled: false, revokedTokens: 2 }
      })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'users:updated' })
    )
  })

  it('turns recovery back on without revoking anything', async () => {
    mockOwner()

    const body = await assertResponse(await put({ enabled: true }), 200)

    expect(body).toEqual({ cardRecoveryEnabled: true })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { cardRecoveryEnabled: true }
    })
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing flag', {}],
    ['a string flag', { enabled: 'false' }],
    ['a numeric flag', { enabled: 0 }]
  ])('rejects %s (400)', async (_label, body) => {
    mockOwner()

    const res = await put(body)

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('404s for a pubkey with no account', async () => {
    mockUnknownPubkey()

    const res = await put({ enabled: false })

    expect(res.status).toBe(404)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('401s without authentication', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no'))

    const res = await put({ enabled: false })

    expect(res.status).toBe(401)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/users/me/account-transfer/dismiss', () => {
  it("dismisses the caller's open transfer notices", async () => {
    mockOwner()
    vi.mocked(prismaMock.accountRecovery.updateMany).mockResolvedValue({
      count: 1
    } as any)

    const body = await assertResponse(await dismiss(), 200)

    expect(body).toEqual({ dismissed: 1 })
    expect(prismaMock.accountRecovery.updateMany).toHaveBeenCalledWith({
      where: { fromUserId: USER_ID, noticeDismissedAt: null },
      data: { noticeDismissedAt: expect.any(Date) }
    })
  })

  it('is idempotent when nothing is open', async () => {
    mockOwner()
    vi.mocked(prismaMock.accountRecovery.updateMany).mockResolvedValue({
      count: 0
    } as any)

    const body = await assertResponse(await dismiss(), 200)

    expect(body).toEqual({ dismissed: 0 })
  })

  it('404s for a pubkey with no account', async () => {
    mockUnknownPubkey()

    const res = await dismiss()

    expect(res.status).toBe(404)
    expect(prismaMock.accountRecovery.updateMany).not.toHaveBeenCalled()
  })

  it('401s without authentication', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no'))

    const res = await dismiss()

    expect(res.status).toBe(401)
    expect(prismaMock.accountRecovery.updateMany).not.toHaveBeenCalled()
  })
})
