import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  fetchDestinationMetadata: vi.fn(),
  reconcileProxyPayments: vi.fn(),
  resolvePublicEndpoint: vi.fn(),
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

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: mocks.authenticate
}))

vi.mock('@/lib/proxy/lnurl', () => ({
  fetchDestinationMetadata: mocks.fetchDestinationMetadata
}))

vi.mock('@/lib/proxy/reconcile', () => ({
  reconcileProxyPayments: mocks.reconcileProxyPayments
}))

vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: mocks.resolvePublicEndpoint
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: mocks.emit }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PROXY_DESTINATION_CHANGED: 'proxy.destination_changed',
    PROXY_FORWARD_RETRY_REQUESTED: 'proxy.forward_retry_requested'
  },
  logActivity: { fireAndForget: mocks.fireAndForget }
}))

import { POST } from '@/app/api/wallet/addresses/[username]/invoices/[invoiceId]/forwarding/route'

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proxy-1',
    invoiceId: 'invoice-1',
    username: 'proxy',
    destination: 'alice@example.com',
    destinationAmountMsats: BigInt(9_950),
    blockedHosts: [],
    status: 'BLOCKED',
    leaseOwner: null,
    leaseExpiresAt: null,
    invoice: { userId: 'user-1', purpose: 'LUD16_PAYMENT' },
    attempts: [],
    ...overrides
  }
}

function request(body: unknown) {
  return POST(
    createNextRequest(
      '/api/wallet/addresses/proxy/invoices/invoice-1/forwarding',
      { method: 'POST', body }
    ),
    createParamsPromise({ username: 'proxy', invoiceId: 'invoice-1' })
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
    userId: 'user-1'
  } as never)
  mocks.resolvePublicEndpoint.mockResolvedValue({
    url: 'https://wallet.example.com'
  })
})

describe('POST proxy forwarding recovery', () => {
  it('releases a blocked payment and reconciles it immediately', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique)
      .mockResolvedValueOnce(payment() as never)
      .mockResolvedValueOnce({
        id: 'proxy-1',
        status: 'COMPLETED',
        destination: 'alice@example.com',
        lastError: null
      } as never)
    vi.mocked(prismaMock.proxyPayment.updateMany).mockResolvedValue({
      count: 1
    })
    mocks.reconcileProxyPayments.mockResolvedValue({
      claimed: 1,
      completed: 1,
      failed: 0
    })

    const response = await request({ action: 'retry' })
    const body = (await assertResponse(response, 200)) as any

    expect(body.payment.status).toBe('COMPLETED')
    expect(prismaMock.proxyPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'proxy-1', status: 'BLOCKED' }),
        data: expect.objectContaining({
          status: 'READY_TO_FORWARD',
          lastError: null
        })
      })
    )
    expect(mocks.reconcileProxyPayments).toHaveBeenCalledWith({
      ids: ['proxy-1'],
      limit: 1
    })
  })

  it('changes only the failed settlement destination and retires its rejected invoice', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        attempts: [
          {
            id: 'attempt-1',
            attemptNo: 1,
            status: 'REJECTED',
            resolvedAt: null
          }
        ]
      }) as never
    )
    mocks.fetchDestinationMetadata.mockResolvedValue({
      callback: 'https://new.example.org/.well-known/lnurlp/bob',
      minSendable: 1,
      maxSendable: 100_000_000,
      commentAllowed: 0,
      metadata: '[]'
    })
    vi.mocked(prismaMock.proxyForwardAttempt.update).mockResolvedValue(
      {} as never
    )
    vi.mocked(prismaMock.proxyPayment.update).mockResolvedValue({} as never)

    const response = await request({
      action: 'change_destination',
      destination: 'Bob@New.Example.org'
    })
    const body = (await assertResponse(response, 200)) as any

    expect(body.payment).toMatchObject({
      status: 'BLOCKED',
      destination: 'bob@new.example.org'
    })
    expect(prismaMock.proxyForwardAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        errorCode: 'destination_changed',
        errorMessage: 'Superseded by bob@new.example.org'
      })
    })
    expect(prismaMock.proxyPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proxy-1' },
        data: expect.objectContaining({
          destination: 'bob@new.example.org',
          leaseOwner: null,
          leaseExpiresAt: null
        })
      })
    )
    expect(mocks.reconcileProxyPayments).not.toHaveBeenCalled()
  })

  it('refuses a destination change while an outgoing payment is ambiguous', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        attempts: [
          {
            id: 'attempt-1',
            attemptNo: 1,
            status: 'UNKNOWN',
            resolvedAt: null
          }
        ]
      }) as never
    )

    const response = await request({
      action: 'change_destination',
      destination: 'bob@new.example.org'
    })

    expect(response.status).toBe(409)
    expect(mocks.fetchDestinationMetadata).not.toHaveBeenCalled()
    expect(prismaMock.proxyPayment.update).not.toHaveBeenCalled()
  })

  it("does not expose another owner's payment", async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      userId: 'user-2'
    } as never)

    const response = await request({ action: 'retry' })

    expect(response.status).toBe(404)
    expect(prismaMock.proxyPayment.findUnique).not.toHaveBeenCalled()
    expect(mocks.reconcileProxyPayments).not.toHaveBeenCalled()
  })
})
