import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { assertResponse } from '@/tests/helpers/api-helpers'
// Registers the `@/lib/prisma` mock — the auth helper and the error handler
// pull in modules that would otherwise construct a real client at import time.
import '@/tests/helpers/prisma-mock'

const SECRET = 'listener-shared-secret-0123456789abcdef!'

const configState = vi.hoisted(() => ({
  secret: 'listener-shared-secret-0123456789abcdef!' as string | undefined
}))
const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => void | Promise<void>) => {
    void callback()
  })
)
const reconcileProxyMock = vi.hoisted(() => vi.fn())
const reconcileForwardingMock = vi.hoisted(() => vi.fn())
const reconcileZapReceiptsMock = vi.hoisted(() => vi.fn())
const settleSweepMock = vi.hoisted(() => vi.fn())
const reconcileNotificationsMock = vi.hoisted(() => vi.fn())

vi.mock('next/server', async importActual => ({
  ...(await importActual<typeof import('next/server')>()),
  after: afterMock
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 102400 }
  }))
}))

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({
    enabled: !!configState.secret,
    url: null,
    secret: configState.secret ?? null,
    requestTimeoutMs: 10000,
    urlSource: 'none',
    secretSource: configState.secret ? 'settings' : 'none',
    enabledSource: configState.secret ? 'settings' : 'none'
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))

vi.mock('@/lib/proxy/reconcile', () => ({
  reconcileProxyPayments: reconcileProxyMock
}))
vi.mock('@/lib/remote-wallet-forwarding/reconcile', () => ({
  reconcileRemoteWalletForwarding: reconcileForwardingMock
}))
vi.mock('@/lib/nostr/zap-receipts', () => ({
  reconcileInvoiceZapReceipts: reconcileZapReceiptsMock
}))
vi.mock('@/lib/nostr/zap-settlement', () => ({
  settlePendingZapInvoices: settleSweepMock
}))
vi.mock('@/lib/remote-wallet-notifications/reconcile', () => ({
  reconcileRemoteWalletNotifications: reconcileNotificationsMock
}))

import { POST } from '@/app/api/internal/lud16-proxy/reconcile/route'

function signedRequest(
  payload: unknown = {},
  overrides: { signature?: string; timestamp?: string } = {}
): NextRequest {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const timestamp = overrides.timestamp ?? String(Date.now())
  const signature =
    overrides.signature ??
    'sha256=' +
      createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  return new NextRequest(
    'http://localhost:3000/api/internal/lud16-proxy/reconcile',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lawallet-timestamp': timestamp,
        'x-lawallet-signature': signature
      },
      body
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.secret = SECRET
  reconcileProxyMock.mockResolvedValue(undefined)
  reconcileForwardingMock.mockResolvedValue(undefined)
  reconcileZapReceiptsMock.mockResolvedValue(0)
  settleSweepMock.mockResolvedValue(0)
  reconcileNotificationsMock.mockResolvedValue(undefined)
})

describe('POST /api/internal/lud16-proxy/reconcile', () => {
  it('runs every reconciler for a correctly signed listener tick', async () => {
    const res = await POST(signedRequest())

    await assertResponse(res, 200)
    expect(reconcileProxyMock).toHaveBeenCalledWith({ ids: undefined })
    expect(reconcileForwardingMock).toHaveBeenCalledWith({ ids: undefined })
    expect(reconcileZapReceiptsMock).toHaveBeenCalled()
    expect(reconcileNotificationsMock).toHaveBeenCalled()
  })

  it('sweeps zap settlement so an older listener still gets receipts', async () => {
    // A listener predating the dedicated zap-settle timer only ever calls this
    // route. Without the sweep here, NIP-57 would be advertised and silently
    // broken for any wallet that emits no NIP-47 notification.
    await POST(signedRequest())

    expect(settleSweepMock).toHaveBeenCalledTimes(1)
  })

  it('sweeps even when the tick names specific settlements', async () => {
    // The ids narrow the proxy reconciler only — the sweep is unconditional.
    await POST(signedRequest({ settlementIds: ['settlement-1'] }))

    expect(reconcileProxyMock).toHaveBeenCalledWith({ ids: ['settlement-1'] })
    expect(settleSweepMock).toHaveBeenCalledTimes(1)
  })

  it('narrows the forwarding reconciler to the named receipts', async () => {
    await POST(signedRequest({ forwardingReceiptIds: ['receipt-1'] }))

    expect(reconcileForwardingMock).toHaveBeenCalledWith({
      ids: ['receipt-1']
    })
  })

  it('defers the work so the listener tick returns immediately', async () => {
    await POST(signedRequest())

    expect(afterMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a bad signature', async () => {
    const res = await POST(signedRequest({}, { signature: 'sha256=deadbeef' }))

    expect(res.status).toBe(401)
    expect(settleSweepMock).not.toHaveBeenCalled()
  })

  it('rejects a replayed timestamp outside the skew window', async () => {
    const res = await POST(
      signedRequest({}, { timestamp: String(Date.now() - 60 * 60 * 1000) })
    )

    expect(res.status).toBe(401)
    expect(reconcileProxyMock).not.toHaveBeenCalled()
  })

  it('404s when no listener is configured', async () => {
    configState.secret = undefined

    const res = await POST(signedRequest())

    expect(res.status).toBe(404)
    expect(reconcileProxyMock).not.toHaveBeenCalled()
  })

  it('treats an empty signed body as a plain full-pass tick', async () => {
    const res = await POST(signedRequest(''))

    await assertResponse(res, 200)
    expect(reconcileProxyMock).toHaveBeenCalledWith({ ids: undefined })
    expect(settleSweepMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a body that is not JSON', async () => {
    const res = await POST(signedRequest('not json at all'))

    expect(res.status).toBe(400)
    expect(reconcileProxyMock).not.toHaveBeenCalled()
  })

  it('rejects an id list that is not an array of strings', async () => {
    const res = await POST(signedRequest({ settlementIds: [42] }))

    expect(res.status).toBe(400)
    expect(reconcileProxyMock).not.toHaveBeenCalled()
  })

  it('rejects more ids than one tick is allowed to name', async () => {
    const res = await POST(
      signedRequest({
        settlementIds: Array.from({ length: 11 }, (_, i) => `s-${i}`)
      })
    )

    expect(res.status).toBe(400)
    expect(reconcileProxyMock).not.toHaveBeenCalled()
  })
})
