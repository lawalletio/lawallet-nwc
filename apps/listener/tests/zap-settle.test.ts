import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { requestZapSettlement } from '../src/zap-settle'
import type { ListenerEnv } from '../src/env'

function env(overrides: Partial<ListenerEnv> = {}): ListenerEnv {
  return {
    LISTENER_AUTH_SECRET: 'listener-shared-secret-0123456789abcdef',
    WEB_ORIGIN: 'https://lawallet.example',
    ...overrides
  } as ListenerEnv
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('zap settlement wakeup', () => {
  it('HMAC-signs the tick and names no invoice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ accepted: true }))
    vi.stubGlobal('fetch', fetchMock)
    const config = env()

    await requestZapSettlement(config, logger())

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'https://lawallet.example/api/internal/zaps/settle'
    )
    const headers = init.headers as Record<string, string>
    const raw = String(init.body)
    // The listener stays transport-only: web selects the candidates, so the
    // body carries no settlement opinion and no invoice id.
    expect(raw).toBe('{}')
    const expected = createHmac('sha256', config.LISTENER_AUTH_SECRET)
      .update(`${headers['x-lawallet-timestamp']}.${raw}`)
      .digest('hex')
    expect(headers['x-lawallet-signature']).toBe(`sha256=${expected}`)
  })

  it('warns without throwing when web rejects the tick', async () => {
    // A web build predating this endpoint answers 404 — the listener must keep
    // ticking rather than crash the process.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const log = logger()

    await expect(requestZapSettlement(env(), log)).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(
      { status: 404 },
      'zap_settle.web_rejected_request'
    )
  })

  it('warns without throwing when web is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const log = logger()

    await expect(requestZapSettlement(env(), log)).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'zap_settle.web_unreachable'
    )
  })
})
