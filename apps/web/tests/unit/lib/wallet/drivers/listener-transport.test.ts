import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const configState = vi.hoisted(() => ({
  url: 'http://listener.test:4100' as string | undefined,
  secret: 'listener-shared-secret-0123456789abcdef!' as string | undefined,
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    listener: {
      url: configState.url,
      secret: configState.secret,
      requestTimeoutMs: 10000,
      enabled: !!(configState.url && configState.secret),
      webhookEnabled: !!configState.secret,
    },
  })),
}))

import { DriverRemoteError } from '@/lib/wallet/drivers/errors'
import {
  isListenerBridgeEnabled,
  listenerNwcRequest,
  ListenerUnavailableError,
} from '@/lib/wallet/drivers/listener-transport'

const INPUT = {
  connectionString: 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s',
  method: 'pay_invoice' as const,
  params: { invoice: 'lnbc1' },
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.url = 'http://listener.test:4100'
  configState.secret = 'listener-shared-secret-0123456789abcdef!'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isListenerBridgeEnabled', () => {
  it('is true only when url AND secret are configured', () => {
    expect(isListenerBridgeEnabled()).toBe(true)
    configState.url = undefined
    expect(isListenerBridgeEnabled()).toBe(false)
  })
})

describe('listenerNwcRequest', () => {
  it('POSTs to /nwc/request with bearer auth and returns the result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ok: true, result: { preimage: 'p', fees_paid: 1000 } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listenerNwcRequest<{ preimage: string }>(INPUT)
    expect(result.preimage).toBe('p')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://listener.test:4100/nwc/request')
    expect((init.headers as Record<string, string>).authorization).toContain('Bearer ')
    expect(JSON.parse(init.body as string)).toEqual({
      connectionString: INPUT.connectionString,
      method: 'pay_invoice',
      params: { invoice: 'lnbc1' },
    })
  })

  it('throws ListenerUnavailableError when the bridge is not configured', async () => {
    configState.url = undefined
    await expect(listenerNwcRequest(INPUT)).rejects.toBeInstanceOf(
      ListenerUnavailableError
    )
  })

  it('throws ListenerUnavailableError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(listenerNwcRequest(INPUT)).rejects.toBeInstanceOf(
      ListenerUnavailableError
    )
  })

  it('throws ListenerUnavailableError on a malformed response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 502 }))
    )
    await expect(listenerNwcRequest(INPUT)).rejects.toBeInstanceOf(
      ListenerUnavailableError
    )
  })

  it('throws ListenerUnavailableError for transport error codes (fallback allowed)', async () => {
    for (const code of [
      'wallet_not_found',
      'wallet_not_connected',
      'timeout',
      'relay_error',
      'validation_error',
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json(
            { ok: false, error: { code, message: 'nope' } },
            { status: 502 }
          )
        )
      )
      await expect(listenerNwcRequest(INPUT)).rejects.toBeInstanceOf(
        ListenerUnavailableError
      )
    }
  })

  it('throws a FINAL DriverRemoteError for wallet_error (no fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            ok: false,
            error: {
              code: 'wallet_error',
              walletErrorCode: 'INSUFFICIENT_BALANCE',
              message: 'not enough sats',
            },
          },
          { status: 502 }
        )
      )
    )
    const err = await listenerNwcRequest(INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriverRemoteError)
    expect(err).not.toBeInstanceOf(ListenerUnavailableError)
    expect((err as Error).message).toContain('INSUFFICIENT_BALANCE')
  })
})
