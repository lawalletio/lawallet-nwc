import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    maintenance: { enabled: false },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    isDevelopment: false,
    isTest: true
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { sensitive: { maxRequests: 5, maxRequestsAuth: 20 } }
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  resolveAccountByPubkey: vi.fn(),
  forgetResolvedAccounts: vi.fn()
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: new Proxy(
    {},
    { get: (_t, key) => `user.${String(key).toLowerCase()}` }
  ),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

import { DELETE } from '@/app/api/account/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { logActivity } from '@/lib/activity-log'
import { eventBus } from '@/lib/events/event-bus'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

const PK_A = 'a'.repeat(64)
const USER_ID = 'user-a'

function authedAs(role: 'USER' | 'ADMIN' = 'USER') {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PK_A,
    role: role === 'ADMIN' ? Role.ADMIN : Role.USER,
    method: 'jwt'
  } as any)
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({
    id: USER_ID,
    primaryPubkey: PK_A,
    authPubkey: PK_A,
    role
  } as any)
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    role,
    pubkey: PK_A,
    nostrIdentities: [{ pubkey: PK_A }]
  } as any)
  vi.mocked(prismaMock.settings.findUnique).mockResolvedValue({
    name: 'root',
    value: 'f'.repeat(64)
  } as any)
  for (const model of [
    prismaMock.cardActivationToken,
    prismaMock.card,
    prismaMock.remoteWalletForwardReceipt,
    prismaMock.remoteWallet,
    prismaMock.lightningAddress,
    prismaMock.webAuthnChallenge,
    prismaMock.proxyInvoiceIntent
  ]) {
    vi.mocked(model.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(model.deleteMany).mockResolvedValue({ count: 1 } as any)
  }
}

const del = (body?: unknown) =>
  DELETE(createNextRequest('/api/account', { method: 'DELETE', body }))

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('DELETE /api/account', () => {
  it('deletes the account, scoped to the caller, and returns { deleted: true }', async () => {
    authedAs()

    const response = await del({ confirm: 'DELETE' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })

    // Every explicit write targets the caller's rows only.
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', card: { userId: USER_ID } },
      data: { status: 'REVOKED' }
    })
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: {
        userId: null,
        username: null,
        remoteWalletId: null,
        kind: 'SIMPLE'
      }
    })
    expect(
      prismaMock.remoteWalletForwardReceipt.deleteMany
    ).toHaveBeenCalledWith({
      where: { OR: [{ userId: USER_ID }, { wallet: { userId: USER_ID } }] }
    })
    for (const model of [
      prismaMock.remoteWallet,
      prismaMock.lightningAddress,
      prismaMock.webAuthnChallenge,
      prismaMock.proxyInvoiceIntent
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID }
      })
    }
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: USER_ID }
    })
    // A USER never takes the admin lock.
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.account_deleted',
        level: 'WARN',
        metadata: expect.objectContaining({ deletedUserId: USER_ID })
      })
    )
    // The deleted row can't be an ActivityLog FK target.
    expect(
      vi.mocked(logActivity.fireAndForget).mock.calls[0][0]
    ).not.toHaveProperty('userId')
    const emitted = vi.mocked(eventBus.emit).mock.calls.map(c => c[0].type)
    expect(emitted).toEqual(
      expect.arrayContaining(['users:updated', 'addresses:updated'])
    )
  })

  it('accepts a request with no body', async () => {
    authedAs()
    const response = await del()
    expect(response.status).toBe(200)
    expect(prismaMock.user.delete).toHaveBeenCalled()
  })

  it('400s on a confirm value other than "DELETE"', async () => {
    authedAs()
    const response = await del({ confirm: 'yes' })
    expect(response.status).toBe(400)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it('401s without auth and touches nothing', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('Missing auth')
    )
    const response = await del({ confirm: 'DELETE' })
    expect(response.status).toBe(401)
    expect((await response.json()).success).toBe(false)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('404s when no account exists for the pubkey', async () => {
    authedAs()
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    const response = await del()
    expect(response.status).toBe(404)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it('404s when the account is deleted concurrently before the transaction', async () => {
    authedAs()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    const response = await del()
    expect(response.status).toBe(404)
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it('403s for the last admin', async () => {
    authedAs('ADMIN')
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ id: USER_ID }])

    const response = await del({ confirm: 'DELETE' })

    expect(response.status).toBe(403)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
  })

  it('lets an admin delete while another admin remains', async () => {
    authedAs('ADMIN')
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      { id: USER_ID },
      { id: 'user-b' }
    ])
    const response = await del()
    expect(response.status).toBe(200)
    expect(prismaMock.user.delete).toHaveBeenCalled()
  })

  it('403s for the instance root, even via a secondary identity', async () => {
    authedAs()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      role: 'USER',
      pubkey: PK_A,
      nostrIdentities: [{ pubkey: PK_A }, { pubkey: 'f'.repeat(64) }]
    } as any)

    const response = await del()

    expect(response.status).toBe(403)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })
})
