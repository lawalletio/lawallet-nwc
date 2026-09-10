import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { assertResponse } from '@/tests/helpers/api-helpers'
// Registers the `@/lib/prisma` mock — the route pulls in the activity log,
// which would otherwise construct a real client at import time.
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
const settleSweepMock = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/nostr/zap-settlement', () => ({
  settlePendingZapInvoices: settleSweepMock
}))

import { POST } from '@/app/api/internal/zaps/settle/route'

function signedRequest(
  payload: unknown = {},
  overrides: {
    signature?: string
    timestamp?: string
    omitSignature?: boolean
  } = {}
): NextRequest {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const timestamp = overrides.timestamp ?? String(Date.now())
  const signature =
    overrides.signature ??
    'sha256=' +
      createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-lawallet-timestamp': timestamp
  }
  if (!overrides.omitSignature) headers['x-lawallet-signature'] = signature
  return new NextRequest('http://localhost:3000/api/internal/zaps/settle', {
    method: 'POST',
    headers,
    body
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.secret = SECRET
  settleSweepMock.mockResolvedValue(0)
})

describe('POST /api/internal/zaps/settle', () => {
  it('runs the sweep for a correctly signed listener tick', async () => {
    const res = await POST(signedRequest())

    await assertResponse(res, 200)
    expect(settleSweepMock).toHaveBeenCalledTimes(1)
  })

  it('defers the sweep so the listener tick returns immediately', async () => {
    await POST(signedRequest())

    expect(afterMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a bad signature', async () => {
    const res = await POST(signedRequest({}, { signature: 'sha256=deadbeef' }))

    expect(res.status).toBe(401)
    expect(settleSweepMock).not.toHaveBeenCalled()
  })

  it('rejects a missing signature', async () => {
    const res = await POST(signedRequest({}, { omitSignature: true }))

    expect(res.status).toBe(401)
    expect(settleSweepMock).not.toHaveBeenCalled()
  })

  it('rejects a replayed timestamp outside the skew window', async () => {
    const res = await POST(
      signedRequest({}, { timestamp: String(Date.now() - 60 * 60 * 1000) })
    )

    expect(res.status).toBe(401)
    expect(settleSweepMock).not.toHaveBeenCalled()
  })

  it('404s when no listener is configured', async () => {
    // The endpoint must not exist for a deployment that runs web alone.
    configState.secret = undefined

    const res = await POST(signedRequest())

    expect(res.status).toBe(404)
    expect(settleSweepMock).not.toHaveBeenCalled()
  })

  it('ignores the request body — web picks the candidates itself', async () => {
    // A compromised ping must not be able to steer the sweep at a chosen row.
    const res = await POST(signedRequest({ invoiceIds: ['attacker-choice'] }))

    await assertResponse(res, 200)
    expect(settleSweepMock).toHaveBeenCalledWith()
  })
})
