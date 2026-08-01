import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  reconcileProxyPayments: vi.fn(),
  emit: vi.fn(),
  fireAndForget: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: mocks.authenticate
}))

vi.mock('@/lib/proxy/reconcile', () => ({
  reconcileProxyPayments: mocks.reconcileProxyPayments
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: mocks.emit }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PROXY_FORWARD_RETRY_REQUESTED: 'proxy.forward_retry_requested'
  },
  logActivity: { fireAndForget: mocks.fireAndForget }
}))

import {
  GET,
  POST
} from '@/app/api/wallet/addresses/[username]/proxy-balance/route'

function getRequest() {
  return GET(
    createNextRequest('/api/wallet/addresses/proxy/proxy-balance'),
    createParamsPromise({ username: 'proxy' })
  )
}

function postRequest() {
  return POST(
    createNextRequest('/api/wallet/addresses/proxy/proxy-balance', {
      method: 'POST'
    }),
    createParamsPromise({ username: 'proxy' })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'USER',
    method: 'jwt'
  })
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user-1'
  } as never)
  vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
    userId: 'user-1',
    mode: 'PROXY_ALIAS',
    redirect: 'alice@example.com'
  } as never)
})

describe('GET proxy pending balance', () => {
  it('sums only confirmed net amounts that have not been forwarded', async () => {
    vi.mocked(prismaMock.proxyPayment.aggregate).mockResolvedValue({
      _sum: { destinationAmountMsats: BigInt(9_950) },
      _count: { _all: 1 },
      _min: { createdAt: new Date('2026-07-31T21:42:00.000Z') }
    } as never)
    vi.mocked(prismaMock.proxyPayment.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)

    const response = await getRequest()
    const body = (await assertResponse(response, 200)) as any

    expect(body).toEqual({
      pendingAmountMsats: '9950',
      pendingPaymentCount: 1,
      blockedPaymentCount: 1,
      inFlightPaymentCount: 0,
      oldestPendingAt: '2026-07-31T21:42:00.000Z',
      destination: 'alice@example.com'
    })
    expect(prismaMock.proxyPayment.aggregate).toHaveBeenCalledWith({
      where: {
        username: 'proxy',
        status: {
          in: ['PENDING_INBOUND', 'READY_TO_FORWARD', 'FORWARDING', 'BLOCKED']
        },
        forwardedAt: null,
        forwardedAmountMsats: null,
        invoice: { is: { userId: 'user-1', status: 'PAID' } },
        attempts: { none: { status: 'SUCCEEDED' } }
      },
      _sum: { destinationAmountMsats: true },
      _count: { _all: true },
      _min: { createdAt: true }
    })
  })

  it('returns an exact zero when every confirmed payment is forwarded', async () => {
    vi.mocked(prismaMock.proxyPayment.aggregate).mockResolvedValue({
      _sum: { destinationAmountMsats: null },
      _count: { _all: 0 },
      _min: { createdAt: null }
    } as never)
    vi.mocked(prismaMock.proxyPayment.count).mockResolvedValue(0)

    const response = await getRequest()
    const body = (await assertResponse(response, 200)) as any

    expect(body).toMatchObject({
      pendingAmountMsats: '0',
      pendingPaymentCount: 0,
      blockedPaymentCount: 0,
      inFlightPaymentCount: 0,
      oldestPendingAt: null
    })
  })

  it("does not expose another owner's pending payment amounts", async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      userId: 'user-2',
      mode: 'PROXY_ALIAS',
      redirect: 'alice@example.com'
    } as never)

    const response = await getRequest()

    expect(response.status).toBe(404)
    expect(prismaMock.proxyPayment.aggregate).not.toHaveBeenCalled()
  })
})

describe('POST proxy pending balance', () => {
  const safePayment = {
    id: 'proxy-payment-1',
    status: 'BLOCKED',
    leaseOwner: null,
    leaseExpiresAt: null,
    hasAmbiguousAttempt: false
  }

  it('locks and releases safe pending funds for immediate reconciliation', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([safePayment] as never)
    vi.mocked(prismaMock.proxyPayment.updateMany).mockResolvedValue({
      count: 1
    })
    mocks.reconcileProxyPayments.mockResolvedValue({
      claimed: 1,
      completed: 1,
      failed: 0
    })

    const response = await postRequest()
    const body = (await assertResponse(response, 200)) as any

    expect(body).toEqual({
      success: true,
      queued: 1,
      reconciliation: { claimed: 1, completed: 1, failed: 0 }
    })
    expect(prismaMock.proxyPayment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['proxy-payment-1'] },
        status: {
          in: ['PENDING_INBOUND', 'READY_TO_FORWARD', 'BLOCKED']
        },
        forwardedAt: null,
        forwardedAmountMsats: null,
        OR: [
          { leaseOwner: null },
          { leaseExpiresAt: { lt: expect.any(Date) } }
        ],
        attempts: {
          none: { status: { in: ['PENDING', 'UNKNOWN', 'SUCCEEDED'] } }
        }
      },
      data: {
        status: 'READY_TO_FORWARD',
        nextRetryAt: expect.any(Date),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
    expect(mocks.reconcileProxyPayments).toHaveBeenCalledWith({
      ids: ['proxy-payment-1']
    })
    expect(mocks.emit).toHaveBeenCalledWith({
      type: 'invoices:updated',
      timestamp: expect.any(Number)
    })
  })

  it.each([
    [
      'an active worker lease',
      { leaseExpiresAt: new Date(Date.now() + 60_000) }
    ],
    ['a forwarding status', { status: 'FORWARDING' }],
    ['an ambiguous outgoing attempt', { hasAmbiguousAttempt: true }]
  ])('rejects pending funds with %s', async (_label, override) => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      { ...safePayment, ...override }
    ] as never)

    const response = await postRequest()

    expect(response.status).toBe(409)
    expect(prismaMock.proxyPayment.updateMany).not.toHaveBeenCalled()
    expect(mocks.reconcileProxyPayments).not.toHaveBeenCalled()
  })

  it('rolls back when a concurrent state change prevents the guarded release', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([safePayment] as never)
    vi.mocked(prismaMock.proxyPayment.updateMany).mockResolvedValue({
      count: 0
    })

    const response = await postRequest()

    expect(response.status).toBe(409)
    expect(mocks.reconcileProxyPayments).not.toHaveBeenCalled()
  })

  it("does not release another owner's pending funds", async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      userId: 'user-2',
      mode: 'PROXY_ALIAS'
    } as never)

    const response = await postRequest()

    expect(response.status).toBe(404)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })
})
