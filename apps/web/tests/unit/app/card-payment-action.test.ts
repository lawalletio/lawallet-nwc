import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { CardPaymentAttempt } from '@/lib/generated/prisma'

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  claim: vi.fn(),
  driverForWallet: vi.fn(),
  driverPay: vi.fn(),
  getInFlight: vi.fn(),
  reconcileDirect: vi.fn(),
  resolveListener: vi.fn(),
  prepareListener: vi.fn(),
  getListenerPayment: vi.fn(),
  submitListenerPayment: vi.fn(),
  succeed: vi.fn(),
  reject: vi.fn(),
  markUnknown: vi.fn(),
  switchToDirect: vi.fn(),
  preimageMatches: vi.fn(),
  findAttempt: vi.fn(),
  findWallet: vi.fn(),
  activity: vi.fn(),
  emit: vi.fn()
}))

vi.mock('light-bolt11-decoder', () => ({ decode: mocks.decode }))

vi.mock('@/lib/card-payments/attempts', () => ({
  claimCardPaymentAttempt: mocks.claim
}))

vi.mock('@/lib/card-payments/lifecycle', () => ({
  succeedCardPaymentAttempt: mocks.succeed,
  rejectCardPaymentAttempt: mocks.reject,
  markCardPaymentUnknown: mocks.markUnknown,
  switchCardPaymentAttemptToDirect: mocks.switchToDirect,
  preimageMatchesPaymentHash: mocks.preimageMatches
}))

vi.mock('@/lib/wallet/drivers', () => {
  class PaymentRejectedError extends Error {
    code?: string
    transport?: 'DIRECT' | 'LISTENER'
  }

  class PaymentOutcomeUnknownError extends Error {
    constructor(
      message: string,
      readonly transport: 'DIRECT' | 'LISTENER'
    ) {
      super(message)
      this.name = 'PaymentOutcomeUnknownError'
    }
  }

  return {
    driverForWallet: mocks.driverForWallet,
    getInFlightDirectPayment: mocks.getInFlight,
    reconcileDirectNwcPayment: mocks.reconcileDirect,
    PaymentRejectedError,
    PaymentOutcomeUnknownError
  }
})

vi.mock('@/lib/wallet/drivers/listener-transport', () => ({
  resolveListenerBridge: mocks.resolveListener,
  prepareListenerPaymentFastPath: mocks.prepareListener,
  getListenerNwcPayment: mocks.getListenerPayment,
  listenerNwcPayment: mocks.submitListenerPayment
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cardPaymentAttempt: { findUnique: mocks.findAttempt },
    remoteWallet: { findUnique: mocks.findWallet }
  }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { CARD_PAYMENT: 'card.payment' },
  logActivity: { fireAndForget: mocks.activity }
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: mocks.emit }
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import pay, {
  type CardPaymentActionCard
} from '@/app/api/cards/[id]/scan/cb/actions/pay'
import { PaymentOutcomeUnknownError } from '@/lib/wallet/drivers'

const PAYMENT_HASH = 'ab'.repeat(32)
const INVOICE = 'lnbc-card-payment'
const NOW_SECONDS = 2_000_000_000

const card: CardPaymentActionCard = {
  id: 'card-1',
  ntag424Cid: 'ntag-cid-1',
  remoteWallet: {
    id: 'wallet-1',
    type: 'NWC',
    status: 'ACTIVE',
    config: {
      connectionString:
        `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`,
      mode: 'SEND_RECEIVE'
    }
  },
  user: null
}

function decodedInvoice(overrides?: {
  amountMsats?: number
  timestamp?: number
  expiry?: number
}) {
  return {
    sections: [
      { name: 'amount', value: String(overrides?.amountMsats ?? 1_000) },
      { name: 'payment_hash', value: PAYMENT_HASH },
      { name: 'timestamp', value: overrides?.timestamp ?? NOW_SECONDS }
    ],
    // light-bolt11-decoder's getter returns an absolute Unix timestamp.
    expiry: overrides?.expiry ?? NOW_SECONDS + 3_600
  }
}

function request(invoice = INVOICE): NextRequest {
  const url = new URL('http://localhost/api/cards/card-1/scan/cb')
  url.searchParams.set('pr', invoice)
  return new NextRequest(url)
}

function attempt(
  overrides: Partial<CardPaymentAttempt> = {}
): CardPaymentAttempt {
  return {
    id: 'attempt-1',
    requestId: 'request-1',
    cardId: card.id,
    counter: 7,
    walletId: 'wallet-1',
    paymentHash: PAYMENT_HASH,
    bolt11: INVOICE,
    amountMsats: 1_000,
    transport: 'DIRECT',
    status: 'PENDING',
    preimage: null,
    feesPaidMsats: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    ...overrides
  }
}

async function responseBody(response: Response) {
  return response.json() as Promise<{ status: string; reason?: string }>
}

describe('card payment callback action', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1_000)
    mocks.decode.mockReturnValue(decodedInvoice())
    mocks.driverForWallet.mockReturnValue({
      driver: { payInvoice: mocks.driverPay },
      config: {
        connectionString:
          `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`,
        mode: 'SEND_RECEIVE'
      }
    })
    mocks.resolveListener.mockResolvedValue({
      enabled: false,
      url: null,
      secret: null,
      webhookSecret: null,
      requestTimeoutMs: 10_000,
      urlSource: 'none',
      secretSource: 'none',
      enabledSource: 'none'
    })
    mocks.prepareListener.mockResolvedValue(true)
    mocks.succeed.mockResolvedValue(true)
    mocks.reject.mockResolvedValue(true)
    mocks.markUnknown.mockResolvedValue(true)
    mocks.switchToDirect.mockResolvedValue(true)
    mocks.preimageMatches.mockReturnValue(true)
    mocks.findAttempt.mockResolvedValue(null)
    mocks.findWallet.mockResolvedValue(null)
    mocks.getInFlight.mockReturnValue(null)
    mocks.getListenerPayment.mockResolvedValue(null)
    mocks.reconcileDirect.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reattaches a duplicate direct callback to its existing in-flight attempt without republishing', async () => {
    const existing = attempt()
    const sharedPayment = Promise.resolve({
      preimage: '01'.repeat(32),
      feesPaidSats: 0,
      feesPaidMsats: 0,
      transport: 'DIRECT' as const
    })
    mocks.claim.mockResolvedValue({ outcome: 'EXISTING', attempt: existing })
    mocks.getInFlight.mockReturnValue(sharedPayment)

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.claim).toHaveBeenCalledTimes(1)
    expect(mocks.getInFlight).toHaveBeenCalledWith(existing.requestId)
    expect(mocks.driverPay).not.toHaveBeenCalled()
    expect(mocks.reconcileDirect).not.toHaveBeenCalled()
    expect(mocks.succeed).toHaveBeenCalledTimes(1)
  })

  it('resumes a pending LISTENER attempt through the status endpoint without publishing again', async () => {
    const existing = attempt({ transport: 'LISTENER' })
    const bridge = {
      enabled: true,
      url: 'http://listener.internal:4100',
      secret: 's'.repeat(32),
      webhookSecret: 'w'.repeat(32),
      requestTimeoutMs: 9_000,
      urlSource: 'settings',
      secretSource: 'settings',
      enabledSource: 'settings'
    }
    mocks.resolveListener.mockResolvedValue(bridge)
    mocks.claim.mockResolvedValue({ outcome: 'EXISTING', attempt: existing })
    mocks.getListenerPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: existing.requestId,
      preimage: '02'.repeat(32),
      feesPaidMsats: 750
    })

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.getListenerPayment).toHaveBeenCalledTimes(1)
    expect(mocks.getListenerPayment).toHaveBeenCalledWith(
      bridge,
      existing.requestId
    )
    expect(mocks.succeed).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({
        preimage: '02'.repeat(32),
        feesPaidMsats: 750,
        transport: 'LISTENER'
      }),
      'LISTENER'
    )
    expect(mocks.driverPay).not.toHaveBeenCalled()
    expect(mocks.getInFlight).not.toHaveBeenCalled()
    expect(mocks.reconcileDirect).not.toHaveBeenCalled()
  })

  it('resubmits the same idempotent LISTENER operation after a crash before the first POST', async () => {
    const existing = attempt({
      requestId: '11'.repeat(32),
      transport: 'LISTENER'
    })
    const bridge = {
      enabled: true,
      url: 'http://listener.internal:4100',
      secret: 's'.repeat(32),
      webhookSecret: 'w'.repeat(32),
      requestTimeoutMs: 9_000,
      urlSource: 'settings',
      secretSource: 'settings',
      enabledSource: 'settings'
    }
    mocks.resolveListener.mockResolvedValue(bridge)
    mocks.claim.mockResolvedValue({ outcome: 'EXISTING', attempt: existing })
    // No listener journal row: web stopped after committing its attempt and
    // before making the original POST.
    mocks.getListenerPayment.mockResolvedValue(null)
    mocks.submitListenerPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: existing.requestId,
      preimage: '04'.repeat(32),
      feesPaidMsats: 500
    })

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.getListenerPayment).toHaveBeenCalledWith(
      bridge,
      existing.requestId
    )
    expect(mocks.submitListenerPayment).toHaveBeenCalledWith(bridge, {
      requestId: existing.requestId,
      walletId: existing.walletId,
      invoice: existing.bolt11,
      paymentHash: existing.paymentHash,
      waitMs: 8_000
    })
    expect(mocks.succeed).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({
        preimage: '04'.repeat(32),
        feesPaidMsats: 500,
        transport: 'LISTENER'
      }),
      'LISTENER'
    )
    expect(mocks.switchToDirect).not.toHaveBeenCalled()
    expect(mocks.driverPay).not.toHaveBeenCalled()
    expect(mocks.getInFlight).not.toHaveBeenCalled()
    expect(mocks.reconcileDirect).not.toHaveBeenCalled()
  })

  it('keeps a resumed LISTENER attempt pinned when the idempotent POST is ambiguous', async () => {
    const existing = attempt({
      requestId: '22'.repeat(32),
      transport: 'LISTENER'
    })
    mocks.resolveListener.mockResolvedValue({
      enabled: true,
      url: 'http://listener.internal:4100',
      secret: 's'.repeat(32),
      webhookSecret: 'w'.repeat(32),
      requestTimeoutMs: 9_000,
      urlSource: 'settings',
      secretSource: 'settings',
      enabledSource: 'settings'
    })
    mocks.claim.mockResolvedValue({ outcome: 'EXISTING', attempt: existing })
    mocks.getListenerPayment.mockResolvedValue(null)
    mocks.submitListenerPayment.mockRejectedValue(
      new Error('connection reset after POST')
    )

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({
      status: 'ERROR',
      reason: 'Payment outcome is still being resolved'
    })
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(mocks.markUnknown).toHaveBeenCalledWith(
      existing.id,
      'LISTENER_PAYMENT_PENDING',
      'LISTENER'
    )
    expect(mocks.switchToDirect).not.toHaveBeenCalled()
    expect(mocks.driverPay).not.toHaveBeenCalled()
    expect(mocks.getInFlight).not.toHaveBeenCalled()
    expect(mocks.reconcileDirect).not.toHaveBeenCalled()
  })

  it('resumes a pending DIRECT attempt through lookup_invoice without publishing again', async () => {
    const existing = attempt({ transport: 'DIRECT' })
    mocks.claim.mockResolvedValue({ outcome: 'EXISTING', attempt: existing })
    mocks.findWallet.mockResolvedValue({
      type: 'NWC',
      config: {
        connectionString:
          `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`,
        mode: 'SEND_RECEIVE'
      }
    })
    mocks.reconcileDirect.mockResolvedValue({
      preimage: '03'.repeat(32),
      feesPaidSats: 1,
      feesPaidMsats: 1_250,
      transport: 'DIRECT'
    })

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.getInFlight).toHaveBeenCalledWith(existing.requestId)
    expect(mocks.findWallet).toHaveBeenCalledWith({
      where: { id: existing.walletId },
      select: { type: true, config: true }
    })
    expect(mocks.reconcileDirect).toHaveBeenCalledWith(
      (card.remoteWallet!.config as { connectionString: string })
        .connectionString,
      existing.paymentHash
    )
    expect(mocks.succeed).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ transport: 'DIRECT' }),
      'DIRECT'
    )
    expect(mocks.driverPay).not.toHaveBeenCalled()
    expect(mocks.getListenerPayment).not.toHaveBeenCalled()
  })

  it('durably switches the attempt to DIRECT before a safe listener fallback dispatch', async () => {
    const created = attempt({ transport: 'LISTENER' })
    mocks.resolveListener.mockResolvedValue({
      enabled: true,
      url: 'http://listener.internal:4100',
      secret: 's'.repeat(32),
      webhookSecret: 'w'.repeat(32),
      requestTimeoutMs: 9_000,
      urlSource: 'settings',
      secretSource: 'settings',
      enabledSource: 'settings'
    })
    mocks.claim.mockResolvedValue({ outcome: 'CREATED', attempt: created })
    mocks.driverPay.mockImplementation(
      async (
        _config,
        _input,
        context: { beforeDirectFallback: () => Promise<boolean> }
      ) => {
        expect(await context.beforeDirectFallback()).toBe(true)
        return {
          preimage: '01'.repeat(32),
          feesPaidSats: 0,
          feesPaidMsats: 0,
          transport: 'DIRECT'
        }
      }
    )

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.switchToDirect).toHaveBeenCalledWith(created.id)
    expect(mocks.succeed).toHaveBeenCalledWith(
      created,
      expect.objectContaining({ transport: 'DIRECT' }),
      'LISTENER'
    )
  })

  it('reconciles an exact retry after its invoice expires without claiming or republishing', async () => {
    const existing = attempt({ status: 'SUCCEEDED' })
    mocks.decode.mockReturnValueOnce(
      decodedInvoice({
        timestamp: NOW_SECONDS - 3_601,
        expiry: NOW_SECONDS - 1
      })
    )
    mocks.findAttempt.mockResolvedValue(existing)

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({ status: 'OK' })
    expect(mocks.findAttempt).toHaveBeenCalledWith({
      where: { cardId_counter: { cardId: card.id, counter: 7 } }
    })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.resolveListener).not.toHaveBeenCalled()
    expect(mocks.driverPay).not.toHaveBeenCalled()
  })

  it('rejects a receive-only wallet before consuming the tap', async () => {
    mocks.driverForWallet.mockReturnValueOnce({
      driver: { payInvoice: mocks.driverPay },
      config: {
        connectionString:
          `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`,
        mode: 'RECEIVE'
      }
    })

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({
      status: 'ERROR',
      reason: 'Card wallet is not enabled for outgoing payments'
    })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.driverPay).not.toHaveBeenCalled()
  })

  it('rechecks expiry after pre-claim setup without decoding twice', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(NOW_SECONDS * 1_000)
    now.mockReturnValue(NOW_SECONDS * 1_000 + 3_600_001)

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({
      status: 'ERROR',
      reason: 'Lightning invoice has expired'
    })
    expect(mocks.decode).toHaveBeenCalledTimes(1)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('persists an ambiguous listener timeout as UNKNOWN without trying another transport', async () => {
    const created = attempt({ transport: 'LISTENER' })
    mocks.resolveListener.mockResolvedValue({
      enabled: true,
      url: 'http://listener.internal:4100',
      secret: 's'.repeat(32),
      webhookSecret: 'w'.repeat(32),
      requestTimeoutMs: 9_000,
      urlSource: 'settings',
      secretSource: 'settings',
      enabledSource: 'settings'
    })
    mocks.claim.mockResolvedValue({ outcome: 'CREATED', attempt: created })
    mocks.driverPay.mockRejectedValue(
      new PaymentOutcomeUnknownError('listener connection reset', 'LISTENER')
    )

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({
      status: 'ERROR',
      reason: 'Payment outcome is still being resolved'
    })
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(mocks.markUnknown).toHaveBeenCalledWith(
      created.id,
      'PAYMENT_OUTCOME_UNKNOWN',
      'LISTENER'
    )
    expect(mocks.driverPay).toHaveBeenCalledTimes(1)
    expect(mocks.getInFlight).not.toHaveBeenCalled()
    expect(mocks.reconcileDirect).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'malformed',
      arrange: () =>
        mocks.decode.mockImplementationOnce(() => {
          throw new Error('bad checksum')
        }),
      reason: 'Invalid Lightning invoice'
    },
    {
      name: 'expired',
      arrange: () =>
        mocks.decode.mockReturnValueOnce(
          decodedInvoice({
            timestamp: NOW_SECONDS - 3_601,
            expiry: NOW_SECONDS - 1
          })
        ),
      reason: 'Lightning invoice has expired'
    },
    {
      name: 'over the advertised amount limit',
      arrange: () =>
        mocks.decode.mockReturnValueOnce(
          decodedInvoice({ amountMsats: 10_000_001 })
        ),
      reason: 'Invoice amount must be between 1 and 10000000 msats'
    }
  ])('rejects a $name invoice before claiming the card tap', async testCase => {
    testCase.arrange()

    const response = await pay(request(), card, 7)

    expect(await responseBody(response)).toEqual({
      status: 'ERROR',
      reason: testCase.reason
    })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.resolveListener).not.toHaveBeenCalled()
    expect(mocks.driverPay).not.toHaveBeenCalled()
  })
})
