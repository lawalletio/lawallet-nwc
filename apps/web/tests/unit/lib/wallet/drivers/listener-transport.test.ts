import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ResolvedListenerConfig } from '@/lib/listener-config'

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn()
}))

import { getListenerConfig } from '@/lib/listener-config'
import { DriverRemoteError } from '@/lib/wallet/drivers/errors'
import {
  listenerNwcRequest,
  ListenerUnavailableError,
  prepareListenerPaymentFastPath,
  resetListenerPaymentCircuit,
  resolveListenerBridge
} from '@/lib/wallet/drivers/listener-transport'

const BRIDGE: ResolvedListenerConfig = {
  enabled: true,
  url: 'http://listener.test:4100',
  secret: 'listener-shared-secret-0123456789abcdef!',
  requestTimeoutMs: 10000,
  urlSource: 'settings',
  secretSource: 'settings',
  enabledSource: 'settings'
}

const INPUT = {
  connectionString: 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s',
  method: 'pay_invoice' as const,
  params: { invoice: 'lnbc1' }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetListenerPaymentCircuit()
})

describe('payment capability cache', () => {
  it('probes once before selecting the listener and reuses the ready result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        status: 'ready',
        capabilities: ['nwc_payments_v1'],
        wallets: { total: 1, ready: 1, notReady: 0 }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(true)
    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://listener.test:4100/ready'
    )
  })

  it('selects direct when the optional listener is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(false)
    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches an old listener without the payment capability', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(false)
    await expect(
      prepareListenerPaymentFastPath(BRIDGE, 'wallet-1')
    ).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
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
      // Ends before our 10s abort so a silent wallet reads as `timeout`.
      timeoutMs: 9000
    })
  })

  it('never asks the listener for less than its 1s minimum wait', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, result: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await listenerNwcRequest(
      { ...BRIDGE, requestTimeoutMs: 1500 },
      { connectionString: INPUT.connectionString, method: 'get_balance' }
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.timeoutMs).toBe(1000)
    expect(body.params).toEqual({})
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
      'validation_error'
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
      await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toMatchObject({
        name: 'ListenerUnavailableError',
        code
      })
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
              message: 'not enough sats'
            }
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

describe('listenerNwcRequest circuit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const ok = () => Response.json({ ok: true, result: { balance: 1 } })

  it('skips the listener without a request while the circuit is open', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge request failed'
    )
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge circuit open'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not open on a listener {ok:false} answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, error: { code: 'wallet_not_connected', message: 'x' } },
          { status: 502 }
        )
      )
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toMatchObject({
      code: 'wallet_not_connected'
    })
    await expect(listenerNwcRequest(BRIDGE, INPUT)).resolves.toEqual({
      balance: 1
    })
  })

  it('probes /health once the window lapses and closes on success', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(Response.json({ status: 'ok' }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    vi.advanceTimersByTime(30_001)
    await expect(listenerNwcRequest(BRIDGE, INPUT)).resolves.toEqual({
      balance: 1
    })
    await listenerNwcRequest(BRIDGE, INPUT)

    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      'http://listener.test:4100/nwc/request',
      'http://listener.test:4100/health',
      'http://listener.test:4100/nwc/request',
      'http://listener.test:4100/nwc/request'
    ])
  })

  it('re-opens when the half-open health probe fails', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    vi.advanceTimersByTime(30_001)
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge failed its health probe'
    )
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge circuit open'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('listenerNwcRequest circuit edges', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on a JSON body that is not a proxy response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ hello: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'malformed response'
    )
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge circuit open'
    )
  })

  it('a passing probe leaves a circuit that was replaced meanwhile alone', async () => {
    vi.useFakeTimers()
    let releaseProbe!: (r: Response) => void
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockReturnValueOnce(new Promise<Response>(r => (releaseProbe = r)))
      .mockResolvedValue(Response.json({ ok: true, result: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    vi.advanceTimersByTime(30_001)
    const pending = listenerNwcRequest(BRIDGE, INPUT)
    resetListenerPaymentCircuit()
    releaseProbe(Response.json({ status: 'ok' }))
    await expect(pending).resolves.toEqual({})
  })

  it('re-opens when the health probe itself cannot connect', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    vi.advanceTimersByTime(30_001)
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge failed its health probe'
    )
  })

  it('ignores a circuit opened for a different listener URL', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(Response.json({ ok: true, result: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    await expect(
      listenerNwcRequest({ ...BRIDGE, url: 'http://other.test:4100' }, INPUT)
    ).resolves.toEqual({})
  })

  it('lets concurrent half-open callers share one probe, and a newer failure win', async () => {
    vi.useFakeTimers()
    let releaseProbe!: (r: Response) => void
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockReturnValueOnce(new Promise<Response>(r => (releaseProbe = r)))
      .mockRejectedValue(new Error('aborted'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow()
    vi.advanceTimersByTime(30_001)
    const a = listenerNwcRequest(BRIDGE, INPUT)
    const b = listenerNwcRequest(BRIDGE, INPUT)
    // A reset (the settings test button) lands while the probe is in flight.
    resetListenerPaymentCircuit()
    releaseProbe(new Response('down', { status: 503 }))
    await expect(a).rejects.toThrow('Listener bridge failed its health probe')
    await expect(b).rejects.toThrow('Listener bridge failed its health probe')
    // The stale probe must not re-open a circuit that was reset meanwhile.
    await expect(listenerNwcRequest(BRIDGE, INPUT)).rejects.toThrow(
      'Listener bridge request failed'
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
