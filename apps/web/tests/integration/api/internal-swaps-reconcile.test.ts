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
const reconcileMock = vi.hoisted(() => vi.fn())
const countMock = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/integrations/swaps', () => ({
  reconcilePendingSwaps: reconcileMock,
  countFollowedSwaps: countMock
}))

import { POST } from '@/app/api/internal/swaps/reconcile/route'

function signedRequest(signature?: string): NextRequest {
  const body = '{}'
  const timestamp = String(Date.now())
  return new NextRequest('http://localhost:3000/api/internal/swaps/reconcile', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lawallet-timestamp': timestamp,
      'x-lawallet-signature':
        signature ??
        'sha256=' +
          createHmac('sha256', SECRET)
            .update(`${timestamp}.${body}`)
            .digest('hex')
    },
    body
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.secret = SECRET
  reconcileMock.mockResolvedValue(0)
})

describe('POST /api/internal/swaps/reconcile (listener cron)', () => {
  it('runs a pass after responding when swaps are in flight', async () => {
    countMock.mockResolvedValue(2)
    const res = await POST(signedRequest())
    const json = await assertResponse(res, 200)
    expect(json).toEqual({ accepted: true, pending: true, nextPollAt: null })
    expect(afterMock).toHaveBeenCalledOnce()
    expect(reconcileMock).toHaveBeenCalledOnce()
  })

  it('skips the pass and reports idle when nothing is in flight', async () => {
    countMock.mockResolvedValue(0)
    const json = await assertResponse(await POST(signedRequest()), 200)
    expect(json).toMatchObject({ pending: false })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('rejects a bad signature and 404s without a listener', async () => {
    countMock.mockResolvedValue(1)
    expect((await POST(signedRequest('sha256=deadbeef'))).status).toBe(401)
    configState.secret = undefined
    expect((await POST(signedRequest())).status).toBe(404)
    expect(reconcileMock).not.toHaveBeenCalled()
  })
})
