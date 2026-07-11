import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash, createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const SECRET = 'listener-shared-secret-0123456789abcdef!'

const configState = vi.hoisted(() => ({
  secret: 'listener-shared-secret-0123456789abcdef!' as string | undefined,
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({
    enabled: !!configState.secret,
    url: null,
    secret: configState.secret ?? null,
    requestTimeoutMs: 10000,
    urlSource: 'none',
    secretSource: configState.secret ? 'settings' : 'none',
    enabledSource: configState.secret ? 'settings' : 'none',
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

const fireAndForgetMock = vi.fn()
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    NWC_PAYMENT_RECEIVED: 'nwc.payment_received',
    NWC_PAYMENT_SENT: 'nwc.payment_sent',
    NWC_LISTENER_ERROR: 'nwc.listener_error',
    NWC_WALLET_DEAD: 'nwc.wallet_dead',
    INVOICE_PAID: 'invoice.paid',
    CARD_PAYMENT: 'card.payment',
  },
  invoiceLogMetadata: vi.fn(() => ({})),
  logActivity: { fireAndForget: (...args: unknown[]) => fireAndForgetMock(...args) },
}))

import { POST } from '@/app/api/webhooks/nwc/route'
import { eventBus } from '@/lib/events/event-bus'

const HASH = 'a'.repeat(64)
const SENT_PREIMAGE = '11'.repeat(32)
const SENT_HASH = createHash('sha256')
  .update(Buffer.from(SENT_PREIMAGE, 'hex'))
  .digest('hex')

const paymentReceived = {
  type: 'payment_received',
  eventKey: 'event-key-1',
  walletId: 'wallet-1',
  receivedAt: Date.now(),
  payment: {
    paymentHash: HASH,
    preimage: 'b'.repeat(64),
    amountMsats: 21_000,
    feesPaidMsats: 0,
    settledAt: Math.floor(Date.now() / 1000),
    transaction: { amount: 21_000 },
  },
}

const pendingInvoice = {
  id: 'inv-1',
  paymentHash: HASH,
  bolt11: 'lnbc210n1test',
  amountSats: 21,
  description: 'test',
  purpose: 'LUD16_PAYMENT',
  status: 'PENDING',
  preimage: null,
  metadata: null,
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 3600_000),
  paidAt: null,
  createdAt: new Date(),
}

/**
 * Builds the request by signing the EXACT byte string sent as the body —
 * byte identity between the signed string and the wire body is load-bearing
 * for HMAC verification (do not use createNextRequest's body option, which
 * re-stringifies).
 */
function signedRequest(
  payload: unknown,
  overrides: { signature?: string; timestamp?: string; omitSignature?: boolean } = {}
): NextRequest {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const timestamp = overrides.timestamp ?? String(Date.now())
  const signature =
    overrides.signature ??
    'sha256=' + createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-lawallet-timestamp': timestamp,
  }
  if (!overrides.omitSignature) headers['x-lawallet-signature'] = signature
  return new NextRequest('http://localhost:3000/api/webhooks/nwc', {
    method: 'POST',
    headers,
    body,
  })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  configState.secret = SECRET
})

describe('POST /api/webhooks/nwc', () => {
  it('returns 404 when the listener secret is not configured', async () => {
    configState.secret = undefined
    const res = await POST(signedRequest(paymentReceived))
    expect(res.status).toBe(404)
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header with 401', async () => {
    const res = await POST(signedRequest(paymentReceived, { omitSignature: true }))
    expect(res.status).toBe(401)
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a wrong signature with 401', async () => {
    const res = await POST(
      signedRequest(paymentReceived, { signature: 'sha256=' + 'f'.repeat(64) })
    )
    expect(res.status).toBe(401)
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a signature computed over different bytes (tampered body)', async () => {
    const timestamp = String(Date.now())
    const otherBody = JSON.stringify({ ...paymentReceived, walletId: 'evil' })
    const signature =
      'sha256=' +
      createHmac('sha256', SECRET).update(`${timestamp}.${otherBody}`).digest('hex')
    const res = await POST(signedRequest(paymentReceived, { signature, timestamp }))
    expect(res.status).toBe(401)
  })

  it('rejects a stale timestamp with 401', async () => {
    const stale = String(Date.now() - 10 * 60 * 1000)
    const res = await POST(signedRequest(paymentReceived, { timestamp: stale }))
    expect(res.status).toBe(401)
  })

  it('rejects a schema-invalid payload with 400', async () => {
    const res = await POST(signedRequest({ type: 'payment_received', nope: true }))
    expect(res.status).toBe(400)
  })

  it('marks a PENDING invoice PAID on payment_received and emits SSE', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(pendingInvoice as never)
    vi.mocked(prismaMock.invoice.update).mockResolvedValue({} as never)

    const res = await POST(signedRequest(paymentReceived))
    const body = (await assertResponse(res, 200)) as { received: boolean }

    expect(body).toEqual({ received: true })
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentHash: HASH },
        data: expect.objectContaining({
          status: 'PAID',
          preimage: 'b'.repeat(64),
        }),
      })
    )
    const emitted = vi.mocked(eventBus.emit).mock.calls.map(([e]) => e.type)
    expect(emitted).toContain('invoices:updated')
    expect(emitted).toContain('listener:updated')

    // The INVOICE_PAID activity entry must reference the NWC connection
    // (RemoteWallet.id) that reported the payment.
    const invoicePaidCall = fireAndForgetMock.mock.calls.find(
      ([entry]) => (entry as { event: string }).event === 'invoice.paid'
    )
    expect(invoicePaidCall).toBeTruthy()
    expect((invoicePaidCall![0] as { metadata: Record<string, unknown> }).metadata).toEqual(
      expect.objectContaining({ remoteWalletId: 'wallet-1', recovered: false })
    )
  })

  it('flags recovered events in the activity metadata', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)

    const res = await POST(signedRequest({ ...paymentReceived, recovered: true }))
    await assertResponse(res, 200)

    const nwcCall = fireAndForgetMock.mock.calls.find(
      ([entry]) => (entry as { event: string }).event === 'nwc.payment_received'
    )
    expect(nwcCall).toBeTruthy()
    expect((nwcCall![0] as { metadata: Record<string, unknown> }).metadata).toEqual(
      expect.objectContaining({ remoteWalletId: 'wallet-1', recovered: true })
    )
  })

  it('is idempotent: an already-PAID invoice is not updated, still 200', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...pendingInvoice,
      status: 'PAID',
      preimage: 'c'.repeat(64),
    } as never)

    const res = await POST(signedRequest(paymentReceived))
    await assertResponse(res, 200)
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('accepts a payment for an unknown payment hash without touching invoices', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)

    const res = await POST(signedRequest(paymentReceived))
    await assertResponse(res, 200)
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('logs payment_sent without touching invoices', async () => {
    const res = await POST(
      signedRequest({ ...paymentReceived, type: 'payment_sent' })
    )
    await assertResponse(res, 200)
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
    expect(fireAndForgetMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'nwc.payment_sent' })
    )
  })

  it.each(['DIRECT', 'LISTENER'] as const)(
    'reconciles an unresolved %s card attempt from a verified payment_sent notification',
    async transport => {
      vi.mocked(prismaMock.cardPaymentAttempt.findUnique).mockResolvedValue({
        id: 'attempt-1',
        requestId: 'request-1',
        cardId: 'card-1',
        counter: 7,
        walletId: 'wallet-1',
        paymentHash: SENT_HASH,
        bolt11: 'lnbc1cardinvoice',
        amountMsats: 21_000,
        transport,
        status: 'UNKNOWN',
        preimage: null,
        feesPaidMsats: null,
        errorCode: 'PAYMENT_OUTCOME_UNKNOWN',
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      } as never)
      vi.mocked(prismaMock.cardPaymentAttempt.updateMany).mockResolvedValue({
        count: 1,
      } as never)

      const res = await POST(
        signedRequest({
          ...paymentReceived,
          type: 'payment_sent',
          payment: {
            ...paymentReceived.payment,
            paymentHash: SENT_HASH,
            preimage: SENT_PREIMAGE,
          },
        })
      )
      await assertResponse(res, 200)

      expect(prismaMock.cardPaymentAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'attempt-1',
            status: { in: ['PENDING', 'UNKNOWN'] },
            transport,
          },
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            transport,
            preimage: SENT_PREIMAGE,
            resolvedAt: expect.any(Date),
          }),
        })
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cards:updated' })
      )
    }
  )

  it('logs listener_error at WARN without touching invoices', async () => {
    const res = await POST(
      signedRequest({
        type: 'listener_error',
        eventKey: 'err-1',
        receivedAt: Date.now(),
        error: { code: 'connection_failed', message: 'relay unreachable' },
      })
    )
    await assertResponse(res, 200)
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
    expect(fireAndForgetMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'nwc.listener_error', level: 'WARN' })
    )
  })

  const walletDead = {
    type: 'wallet_dead',
    eventKey: 'dead-1',
    walletId: 'wallet-1',
    receivedAt: Date.now(),
    unresponsiveSeconds: 4 * 3600,
    relaysConnected: true,
  }

  it('archives an ACTIVE LNCurl wallet as DEAD on wallet_dead', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      status: 'ACTIVE',
      config: { provider: 'lncurl' },
      name: 'LNCurl wallet',
    } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1,
    } as never)

    const res = await POST(signedRequest(walletDead))
    await assertResponse(res, 200)
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wallet-1', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'DEAD', isDefault: false }),
      })
    )
    expect(fireAndForgetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'nwc.wallet_dead',
        level: 'WARN',
        userId: 'user-1',
      })
    )
  })

  it("never archives a non-LNCurl wallet — the user's own NWC is left alone", async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      status: 'ACTIVE',
      config: { provider: 'nwc' },
      name: 'My Alby',
    } as never)

    const res = await POST(signedRequest(walletDead))
    await assertResponse(res, 200)
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent: a wallet_dead replay for a non-ACTIVE wallet is a no-op', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'wallet-1',
      userId: 'user-1',
      status: 'DEAD',
      config: { provider: 'lncurl' },
      name: 'LNCurl wallet',
    } as never)

    const res = await POST(signedRequest(walletDead))
    await assertResponse(res, 200)
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a wallet_dead payload with relaysConnected:false (schema pins it true)', async () => {
    const res = await POST(
      signedRequest({ ...walletDead, relaysConnected: false })
    )
    expect(res.status).toBe(400)
  })
})
