import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ResolvedListenerConfig } from '@/lib/listener-config'

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(),
}))

import { getListenerConfig } from '@/lib/listener-config'
import { DriverRemoteError } from '@/lib/wallet/drivers/errors'
import {
  listenerNwcRequest,
  ListenerUnavailableError,
  resolveListenerBridge,
} from '@/lib/wallet/drivers/listener-transport'

const BRIDGE: ResolvedListenerConfig = {
  enabled: true,
  url: 'http://listener.test:4100',
  secret: 'listener-shared-secret-0123456789abcdef!',
  requestTimeoutMs: 10000,
  urlSource: 'settings',
  secretSource: 'settings',
  enabledSource: 'settings',
}

const INPUT = {
  connectionString: 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s',
  method: 'pay_invoice' as const,
  params: { invoice: 'lnbc1' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveListenerBridge', () => {
  it('returns the resolved config', async () => {
    vi.mocked(getListenerConfig).mockResolvedValue(BRIDGE)
    await expect(resolveListenerBridge()).resolves.toEqual(BRIDGE)
  })

  it('degrades to disabled when resolution itself fails', async () => {
    vi.mocked(getListenerConfig).mockRejectedValue(new Error('db down'))
    const bridge = await resolveListenerBridge()
    expect(bridge.enabled).toBe(false)
    expect(bridge.url).toBeNull()
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

    const result = await listenerNwcRequest<{ preimage: string }>(BRIDGE, INPUT)
    expect(result.preimage).toBe('p')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://listener.test:4100/nwc/request')
    expect((init.headers as Record<string, string>).authorization).toContain(
      'Bearer '
    )
    expect(JSON.parse(init.body as string)).toEqual({
      connectionString: INPUT.connectionString,
      method: 'pay_invoice',
      params: { invoice: 'lnbc1' },
    })
  })

  it('throws ListenerUnavailableError when the bridge is disabled', async () => {
    await expect(
      listenerNwcRequest({ ...BRIDGE, enabled: false }, INPUT)
    ).rejects.toBeInstanceOf(ListenerUnavailableError)
  })

  it('throws ListenerUnavailableError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toBeInstanceOf(
      ListenerUnavailableError
    )
  })

  it('throws ListenerUnavailableError on a malformed response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 502 }))
    )
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toBeInstanceOf(
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
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { ok: false, error: { code, message: 'nope' } },
              { status: 502 }
            )
          )
      )
      await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toBeInstanceOf(
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
    const err = await listenerNwcRequest(BRIDGE, INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriverRemoteError)
    expect(err).not.toBeInstanceOf(ListenerUnavailableError)
    expect((err as Error).message).toContain('INSUFFICIENT_BALANCE')
  })
})
