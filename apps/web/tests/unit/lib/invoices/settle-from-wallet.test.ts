import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const lookupInvoiceMock = vi.hoisted(() => vi.fn())
const driverForWalletMock = vi.hoisted(() => vi.fn())
const publishReceiptMock = vi.hoisted(() => vi.fn())
const reconcileProxyMock = vi.hoisted(() => vi.fn())
const proxyConfig = vi.hoisted(() => ({
  connectionString: 'nostr+walletconnect://proxy' as string | null
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

vi.mock('@/lib/activity-log', async importActual => ({
  ...(await importActual<typeof import('@/lib/activity-log')>()),
  logActivity: { fireAndForget: vi.fn() }
}))

vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet: driverForWalletMock
}))

vi.mock('@/lib/nostr/zap-receipts', () => ({
  publishInvoiceZapReceipt: publishReceiptMock
}))

vi.mock('@/lib/proxy/reconcile', () => ({
  reconcileProxyPayments: reconcileProxyMock
}))

vi.mock('@/lib/proxy/config', () => ({
  getProxySettlementConfig: vi.fn(async () =>
    proxyConfig.connectionString ? { ...proxyConfig } : null
  )
}))

import {
  resolveInvoiceWallet,
  settleInvoiceFromWallet
} from '@/lib/invoices/settle-from-wallet'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { eventBus } from '@/lib/events/event-bus'

const PREIMAGE = 'a'.repeat(64)
/** A real preimage/hash pair — the proxy branch verifies the relationship. */
const REAL_PREIMAGE = 'b'.repeat(64)
const REAL_HASH = createHash('sha256')
  .update(Buffer.from(REAL_PREIMAGE, 'hex'))
  .digest('hex')

const WALLET = {
  id: 'wallet-1',
  type: 'NWC' as const,
  status: 'ACTIVE' as const,
  config: { connectionString: 'nostr+walletconnect://bound' }
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    bolt11: 'lnbc100n1zap',
    paymentHash: 'c'.repeat(64),
    amountSats: 21,
    description: 'zap',
    purpose: 'LUD16',
    status: 'PENDING' as const,
    preimage: null,
    metadata: null,
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    paidAt: null,
    createdAt: new Date(),
    zapRequest: { kind: 9734 },
    remoteWallet: WALLET,
    proxyPayment: null,
    ...overrides
  } as any
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  proxyConfig.connectionString = 'nostr+walletconnect://proxy'
  lookupInvoiceMock.mockResolvedValue({
    settled: true,
    preimage: PREIMAGE,
    settledAt: 1_700_000_000_000
  })
  driverForWalletMock.mockReturnValue({
    driver: { lookupInvoice: lookupInvoiceMock },
    config: { connectionString: 'nostr+walletconnect://bound' }
  })
  publishReceiptMock.mockResolvedValue('published')
  reconcileProxyMock.mockResolvedValue(undefined)
  vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
    count: 1
  } as never)
})

describe('resolveInvoiceWallet', () => {
  it("prefers the invoice's own wallet over the address's current one", () => {
    // An address rebound to a different wallet must never be asked about an
    // invoice it didn't mint.
    const route = resolveInvoiceWallet(
      { remoteWallet: WALLET },
      {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWallet: { ...WALLET, id: 'wallet-2' }
      }
    )
    expect(route).toMatchObject({ kind: 'wallet', walletId: 'wallet-1' })
  })

  it('falls back to the address for rows minted before the link existed', () => {
    const route = resolveInvoiceWallet(
      { remoteWallet: null },
      { mode: 'CUSTOM_NWC', redirect: null, remoteWallet: WALLET }
    )
    expect(route).toMatchObject({ kind: 'wallet', walletId: 'wallet-1' })
  })

  it('is unconfigured with neither a bound wallet nor an address', () => {
    expect(resolveInvoiceWallet({ remoteWallet: null })).toEqual({
      kind: 'unconfigured'
    })
  })

  it('treats a non-ACTIVE bound wallet as unconfigured', () => {
    expect(
      resolveInvoiceWallet({ remoteWallet: { ...WALLET, status: 'DEAD' } })
    ).toEqual({ kind: 'unconfigured' })
  })
})

describe('settleInvoiceFromWallet', () => {
  it('records a settled invoice, guarding the write on PENDING', async () => {
    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'zap_settlement_sweep'
    })

    expect(result).toEqual({
      outcome: 'settled',
      preimage: PREIMAGE,
      paidAt: new Date(1_700_000_000_000)
    })
    // Guarded so a listener webhook that won the race keeps its own paidAt.
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledWith({
      where: { paymentHash: 'c'.repeat(64), status: 'PENDING' },
      data: {
        status: 'PAID',
        preimage: PREIMAGE,
        paidAt: new Date(1_700_000_000_000)
      }
    })
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
  })

  it('publishes the zap receipt for a zap invoice', async () => {
    await settleInvoiceFromWallet(invoice(), {
      source: 'zap_settlement_sweep'
    })

    expect(publishReceiptMock).toHaveBeenCalledWith('invoice-1')
  })

  it('awaits the receipt publish when no scheduler is supplied', async () => {
    // A background sweep has no `after()` to hand work to, so the publish has
    // to finish before the call returns or nothing would ever run it.
    let published = false
    publishReceiptMock.mockImplementation(async () => {
      published = true
      return 'published'
    })

    await settleInvoiceFromWallet(invoice(), {
      source: 'zap_settlement_sweep'
    })

    expect(published).toBe(true)
  })

  it('hands follow-up work to the caller-supplied scheduler instead', async () => {
    const tasks: Array<() => Promise<void>> = []

    await settleInvoiceFromWallet(invoice(), {
      source: 'lud21_verify',
      schedule: task => tasks.push(task)
    })

    // Deferred, so the payer's verify response isn't held open by relay work.
    expect(publishReceiptMock).not.toHaveBeenCalled()
    expect(tasks).toHaveLength(1)
    await tasks[0]()
    expect(publishReceiptMock).toHaveBeenCalledWith('invoice-1')
  })

  it('skips the receipt for a non-zap invoice', async () => {
    await settleInvoiceFromWallet(invoice({ zapRequest: null }), {
      source: 'lud21_verify'
    })

    expect(publishReceiptMock).not.toHaveBeenCalled()
  })

  it('still reports settled when receipt publishing fails', async () => {
    // Settlement is already durable and the receipt has its own retry loop.
    publishReceiptMock.mockRejectedValue(new Error('relay down'))

    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'zap_settlement_sweep'
    })

    expect(result.outcome).toBe('settled')
  })

  it('reports pending when the wallet says the invoice is unpaid', async () => {
    lookupInvoiceMock.mockResolvedValue({
      settled: false,
      preimage: null,
      settledAt: null
    })

    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'lud21_verify'
    })

    expect(result).toEqual({ outcome: 'pending' })
    expect(prismaMock.invoice.updateMany).not.toHaveBeenCalled()
  })

  it('reports unavailable — not pending — when the lookup fails', async () => {
    // A relay failure is not evidence the invoice is unpaid.
    lookupInvoiceMock.mockRejectedValue(new Error('relay timeout'))

    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'lud21_verify'
    })

    expect(result).toEqual({ outcome: 'unavailable' })
    expect(prismaMock.invoice.updateMany).not.toHaveBeenCalled()
  })

  it('classifies a timeout wrapped in a driver error as a relay timeout', async () => {
    // The driver wraps relay failures, so the classifier has to read the cause.
    lookupInvoiceMock.mockRejectedValue(
      new Error('NWC lookup_invoice failed', {
        cause: new Error('request timed out')
      })
    )

    await settleInvoiceFromWallet(invoice(), { source: 'lud21_verify' })

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ event: ActivityEvent.NWC_RELAY_TIMEOUT })
    )
  })

  it('reports unavailable when there is no wallet to ask', async () => {
    const result = await settleInvoiceFromWallet(
      invoice({ remoteWallet: null }),
      { source: 'zap_settlement_sweep' }
    )

    expect(result).toEqual({ outcome: 'unavailable' })
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('reports unavailable when the driver cannot look invoices up', async () => {
    driverForWalletMock.mockReturnValue({ driver: {}, config: {} })

    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'zap_settlement_sweep'
    })

    expect(result).toEqual({ outcome: 'unavailable' })
  })

  it('reports unavailable when the stored config cannot be read', async () => {
    // A rotated NWC_VAULT_SECRET must degrade, not 500 the public verify route.
    driverForWalletMock.mockImplementation(() => {
      throw new Error('vault envelope is not readable')
    })

    const result = await settleInvoiceFromWallet(invoice(), {
      source: 'lud21_verify'
    })

    expect(result).toEqual({ outcome: 'unavailable' })
  })

  describe('proxy invoices', () => {
    const proxyInvoice = () =>
      invoice({
        paymentHash: REAL_HASH,
        proxyPayment: { id: 'proxy-1' },
        zapRequest: null
      })

    beforeEach(() => {
      lookupInvoiceMock.mockResolvedValue({
        settled: true,
        preimage: REAL_PREIMAGE,
        settledAt: 1_700_000_000_000
      })
      vi.mocked(prismaMock.$transaction).mockImplementation((async (fn: any) =>
        fn(prismaMock)) as never)
    })

    it('marks the payment forwardable and kicks the reconciler', async () => {
      const result = await settleInvoiceFromWallet(proxyInvoice(), {
        source: 'lud21_verify'
      })

      expect(result.outcome).toBe('settled')
      expect(prismaMock.proxyPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proxy-1' },
          data: expect.objectContaining({ sourcePreimage: REAL_PREIMAGE })
        })
      )
      expect(prismaMock.proxyPayment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'READY_TO_FORWARD' }
        })
      )
      expect(reconcileProxyMock).toHaveBeenCalledWith({ ids: ['proxy-1'] })
    })

    it('refuses a preimage that does not hash to the payment hash', async () => {
      // This preimage is about to make a real outbound payment forwardable, so
      // a wallet claiming settlement with an unrelated preimage proves nothing.
      lookupInvoiceMock.mockResolvedValue({
        settled: true,
        preimage: PREIMAGE,
        settledAt: 1_700_000_000_000
      })

      const result = await settleInvoiceFromWallet(proxyInvoice(), {
        source: 'lud21_verify'
      })

      expect(result).toEqual({ outcome: 'pending' })
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('never publishes a zap receipt for a proxy invoice', async () => {
      await settleInvoiceFromWallet(
        invoice({
          paymentHash: REAL_HASH,
          proxyPayment: { id: 'proxy-1' },
          zapRequest: { kind: 9734 }
        }),
        { source: 'lud21_verify' }
      )

      // The receipt belongs to the forwarded payment, which the proxy pipeline
      // publishes once it has actually paid the destination.
      expect(publishReceiptMock).not.toHaveBeenCalled()
    })

    it('reports unavailable when the proxy wallet is not configured', async () => {
      proxyConfig.connectionString = null

      const result = await settleInvoiceFromWallet(proxyInvoice(), {
        source: 'lud21_verify'
      })

      expect(result).toEqual({ outcome: 'unavailable' })
    })
  })
})
