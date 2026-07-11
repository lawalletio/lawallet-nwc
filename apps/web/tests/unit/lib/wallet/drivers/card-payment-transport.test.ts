import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface TestListenerConfig {
  enabled: boolean
  url: string | null
  secret: string | null
  webhookSecret: string | null
  requestTimeoutMs: number
  urlSource: 'settings' | 'env' | 'none'
  secretSource: 'settings' | 'env' | 'none'
  enabledSource: 'settings' | 'env-auto' | 'none'
}

const sdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  payInvoice: vi.fn(),
  close: vi.fn()
}))

const listenerConfig = vi.hoisted(() => ({
  current: {
    enabled: false,
    url: null as string | null,
    secret: null as string | null,
    webhookSecret: null as string | null,
    requestTimeoutMs: 10_000,
    urlSource: 'none' as const,
    secretSource: 'none' as const,
    enabledSource: 'none' as const
  } as TestListenerConfig
}))

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@getalby/sdk', () => {
  class FakeNwcClient {
    constructor(options: { nostrWalletConnectUrl: string }) {
      sdk.constructor(options)
    }

    payInvoice = sdk.payInvoice
    close = sdk.close
  }

  return { NWCClient: FakeNwcClient }
})

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => listenerConfig.current)
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  createLogger: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })),
  getCurrentReqId: vi.fn(() => 'card-payment-test')
}))

import { resetListenerPaymentCircuit } from '@/lib/wallet/drivers/listener-transport'
import { PaymentOutcomeUnknownError } from '@/lib/wallet/drivers/errors'
import { nwcDriver } from '@/lib/wallet/drivers/nwc-driver'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'

const CONNECTION =
  `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`
const CONFIG = { connectionString: CONNECTION, mode: 'SEND_RECEIVE' as const }
const INVOICE = 'lnbc-card-payment'
const PAYMENT_HASH = 'ab'.repeat(32)
const REQUEST_IDS = {
  direct: '11'.repeat(32),
  listener: '22'.repeat(32),
  fallback: '33'.repeat(32),
  ambiguous: '44'.repeat(32),
  duplicate: '55'.repeat(32)
}

function operation(requestId: string, transport: 'DIRECT' | 'LISTENER') {
  return {
    requestId,
    walletId: 'wallet-1',
    paymentHash: PAYMENT_HASH,
    deadlineMs: 8_000,
    transport
  } as const
}

function enableListener() {
  listenerConfig.current = {
    enabled: true,
    url: 'http://listener.internal:4100',
    secret: 's'.repeat(32),
    webhookSecret: 'w'.repeat(32),
    requestTimeoutMs: 9_000,
    urlSource: 'settings',
    secretSource: 'settings',
    enabledSource: 'settings'
  }
}

function listenerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('NWC card payment transport selection', () => {
  beforeEach(() => {
    closeAllServerNwcClients()
    sdk.constructor.mockReset()
    sdk.payInvoice.mockReset()
    sdk.close.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    listenerConfig.current = {
      enabled: false,
      url: null,
      secret: null,
      webhookSecret: null,
      requestTimeoutMs: 10_000,
      urlSource: 'none',
      secretSource: 'none',
      enabledSource: 'none'
    }
    resetListenerPaymentCircuit()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses one direct pooled-client dispatch and makes no listener HTTP request when unconfigured', async () => {
    sdk.payInvoice.mockResolvedValueOnce({
      preimage: '01'.repeat(32),
      fees_paid: 1_500
    })

    const result = await nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.direct, 'DIRECT')
    )

    expect(result).toMatchObject({
      preimage: '01'.repeat(32),
      feesPaidMsats: 1_500,
      transport: 'DIRECT'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sdk.constructor).toHaveBeenCalledTimes(1)
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
    expect(sdk.payInvoice).toHaveBeenCalledWith({
      invoice: INVOICE,
      amount: undefined
    })
  })

  it('uses the ready listener exactly once and never constructs a web NWC client', async () => {
    enableListener()
    fetchMock.mockResolvedValueOnce(
      listenerResponse({
        ok: true,
        status: 'succeeded',
        requestId: REQUEST_IDS.listener,
        preimage: '02'.repeat(32),
        feesPaidMsats: 900
      })
    )

    const result = await nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.listener, 'LISTENER')
    )

    expect(result).toMatchObject({
      preimage: '02'.repeat(32),
      feesPaidMsats: 900,
      transport: 'LISTENER'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://listener.internal:4100/v1/nwc/payments'
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      requestId: REQUEST_IDS.listener,
      walletId: 'wallet-1',
      invoice: INVOICE,
      paymentHash: PAYMENT_HASH,
      waitMs: 8_000
    })
    expect(sdk.constructor).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('treats an idempotent listener wallet rejection as terminal and never pays direct', async () => {
    enableListener()
    fetchMock.mockResolvedValueOnce(
      listenerResponse(
        {
          ok: false,
          status: 'rejected',
          requestId: REQUEST_IDS.listener,
          error: {
            code: 'wallet_error',
            walletErrorCode: 'INSUFFICIENT_BALANCE',
            message: 'not enough sats'
          }
        },
        422
      )
    )

    await expect(
      nwcDriver.payInvoice(
        CONFIG,
        { bolt11: INVOICE },
        operation(REQUEST_IDS.listener, 'LISTENER')
      )
    ).rejects.toMatchObject({
      name: 'PaymentRejectedError',
      code: 'INSUFFICIENT_BALANCE',
      transport: 'LISTENER'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sdk.constructor).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('falls back exactly once when listener proves the operation was not started', async () => {
    enableListener()
    fetchMock.mockResolvedValueOnce(
      listenerResponse(
        {
          ok: false,
          status: 'not_started',
          requestId: REQUEST_IDS.fallback,
          error: {
            code: 'wallet_not_ready',
            message: 'wallet is still negotiating'
          }
        },
        503
      )
    )
    sdk.payInvoice.mockResolvedValueOnce({
      preimage: '03'.repeat(32),
      fees_paid: 0
    })

    const result = await nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.fallback, 'LISTENER')
    )

    expect(result.transport).toBe('DIRECT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sdk.constructor).toHaveBeenCalledTimes(1)
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
  })

  it('persists a safe hand-off when listener configuration disappears after selection', async () => {
    sdk.payInvoice.mockResolvedValueOnce({
      preimage: '05'.repeat(32),
      fees_paid: 0
    })
    const beforeDirectFallback = vi.fn(async () => true)

    const result = await nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      {
        ...operation('99'.repeat(32), 'LISTENER'),
        beforeDirectFallback
      }
    )

    expect(beforeDirectFallback).toHaveBeenCalledTimes(1)
    expect(result.transport).toBe('DIRECT')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
  })

  it('does not publish direct when the configuration-race hand-off loses', async () => {
    const beforeDirectFallback = vi.fn(async () => false)

    await expect(
      nwcDriver.payInvoice(
        CONFIG,
        { bolt11: INVOICE },
        {
          ...operation('aa'.repeat(32), 'LISTENER'),
          beforeDirectFallback
        }
      )
    ).rejects.toMatchObject({
      name: 'PaymentOutcomeUnknownError',
      transport: 'LISTENER'
    })
    expect(beforeDirectFallback).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('does not dispatch direct when the durable transport hand-off loses a race', async () => {
    enableListener()
    fetchMock.mockResolvedValueOnce(
      listenerResponse(
        {
          ok: false,
          status: 'not_started',
          requestId: '88'.repeat(32),
          error: { code: 'wallet_not_ready', message: 'not ready' }
        },
        503
      )
    )
    const beforeDirectFallback = vi.fn(async () => false)

    await expect(
      nwcDriver.payInvoice(
        CONFIG,
        { bolt11: INVOICE },
        {
          ...operation('88'.repeat(32), 'LISTENER'),
          beforeDirectFallback
        }
      )
    ).rejects.toMatchObject({
      name: 'PaymentOutcomeUnknownError',
      transport: 'LISTENER'
    })
    expect(beforeDirectFallback).toHaveBeenCalledTimes(1)
    expect(sdk.constructor).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('keeps an accepted-but-ambiguous listener payment UNKNOWN and never dispatches direct', async () => {
    enableListener()
    fetchMock.mockRejectedValueOnce(new TypeError('connection reset'))

    const result = nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.ambiguous, 'LISTENER')
    )

    await expect(result).rejects.toMatchObject({
      name: 'PaymentOutcomeUnknownError',
      transport: 'LISTENER'
    } satisfies Partial<PaymentOutcomeUnknownError>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sdk.constructor).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('falls back safely when TCP connection refusal proves listener never received the POST', async () => {
    enableListener()
    const refusal = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect refused'), {
        code: 'ECONNREFUSED'
      })
    })
    fetchMock.mockRejectedValueOnce(refusal)
    sdk.payInvoice.mockResolvedValueOnce({
      preimage: '06'.repeat(32),
      fees_paid: 0
    })
    const beforeDirectFallback = vi.fn(async () => true)

    const result = await nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      {
        ...operation('bb'.repeat(32), 'LISTENER'),
        beforeDirectFallback
      }
    )

    expect(beforeDirectFallback).toHaveBeenCalledTimes(1)
    expect(result.transport).toBe('DIRECT')
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
  })

  it('treats a mismatched listener request id as ambiguous and never falls back', async () => {
    enableListener()
    fetchMock.mockResolvedValueOnce(
      listenerResponse(
        {
          ok: false,
          status: 'not_started',
          requestId: 'ff'.repeat(32),
          error: { code: 'wallet_not_ready', message: 'not ready' }
        },
        503
      )
    )

    await expect(
      nwcDriver.payInvoice(
        CONFIG,
        { bolt11: INVOICE },
        operation('77'.repeat(32), 'LISTENER')
      )
    ).rejects.toMatchObject({
      name: 'PaymentOutcomeUnknownError',
      transport: 'LISTENER'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sdk.constructor).not.toHaveBeenCalled()
    expect(sdk.payInvoice).not.toHaveBeenCalled()
  })

  it('single-flights duplicate direct callbacks by requestId', async () => {
    const deferred: {
      resolve?: (value: { preimage: string; fees_paid: number }) => void
    } = {}
    sdk.payInvoice.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          deferred.resolve = resolve
        })
    )

    const first = nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.duplicate, 'DIRECT')
    )
    const duplicate = nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation(REQUEST_IDS.duplicate, 'DIRECT')
    )

    await vi.waitFor(() => expect(sdk.payInvoice).toHaveBeenCalledTimes(1))
    deferred.resolve?.({ preimage: '04'.repeat(32), fees_paid: 0 })

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      expect.objectContaining({ transport: 'DIRECT' }),
      expect.objectContaining({ transport: 'DIRECT' })
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
  })

  it('bounds a direct payment at 60 seconds without dispatching it again', async () => {
    vi.useFakeTimers()
    sdk.payInvoice.mockReturnValueOnce(new Promise(() => undefined))

    const payment = nwcDriver.payInvoice(
      CONFIG,
      { bolt11: INVOICE },
      operation('66'.repeat(32), 'DIRECT')
    )
    const rejected = expect(payment).rejects.toMatchObject({
      name: 'PaymentOutcomeUnknownError',
      transport: 'DIRECT'
    })
    await vi.advanceTimersByTimeAsync(60_000)

    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sdk.payInvoice).toHaveBeenCalledTimes(1)
  })
})
