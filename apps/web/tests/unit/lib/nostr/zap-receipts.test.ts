import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const listenerState = vi.hoisted(() => ({ enabled: true }))
const publishZapReceiptMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: { enabled: true, secret: 'test-vault-secret' }
  }))
}))

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({
    enabled: listenerState.enabled,
    url: 'http://listener.test',
    secret: 'listener-secret',
    requestTimeoutMs: 10_000,
    urlSource: 'settings',
    secretSource: 'settings',
    enabledSource: 'settings'
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

vi.mock('@/lib/proxy/vault', () => ({
  isProxyVaultConfigured: () => true,
  decryptProxySecret: () => '1'.repeat(64)
}))

vi.mock('@/lib/proxy/nostr', () => ({
  publishZapReceipt: publishZapReceiptMock
}))

import {
  getZapReceiptCapability,
  publishInvoiceZapReceipt
} from '@/lib/nostr/zap-receipts'
import { eventBus } from '@/lib/events/event-bus'

const signerConfig = {
  id: 'default',
  receiptNsecCiphertext: new Uint8Array([1, 2, 3]),
  receiptPubkey: 'b'.repeat(64)
}

const zapInvoice = {
  id: 'invoice-1',
  status: 'PAID',
  bolt11: 'lnbc100n1payer',
  preimage: 'a'.repeat(64),
  paidAt: new Date('2026-08-03T12:00:00.000Z'),
  zapRequest: { kind: 9734, tags: [['relays', 'wss://relay.example']] },
  zapRequestJson: '{"kind":9734}',
  zapReceiptEventId: null
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  listenerState.enabled = true
  vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
    signerConfig as never
  )
})

describe('RemoteWallet NIP-57 receipts', () => {
  it('advertises NIP-57 only while the listener and receipt signer are available', async () => {
    await expect(getZapReceiptCapability()).resolves.toEqual({
      lud21: true,
      nip57: true,
      receiptPubkey: signerConfig.receiptPubkey,
      reason: null
    })

    listenerState.enabled = false
    await expect(getZapReceiptCapability()).resolves.toEqual({
      lud21: true,
      nip57: false,
      receiptPubkey: signerConfig.receiptPubkey,
      reason: expect.stringMatching(/listener/i)
    })
  })

  it('claims, publishes, and persists one signed zap receipt', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      zapInvoice as never
    )
    vi.mocked(prismaMock.invoice.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
    publishZapReceiptMock.mockResolvedValue({
      event: { id: 'receipt-event', kind: 9735 },
      json: '{"kind":9735,"id":"receipt-event"}'
    })

    await expect(publishInvoiceZapReceipt(zapInvoice.id)).resolves.toBe(
      'published'
    )

    expect(publishZapReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payerInvoice: zapInvoice.bolt11,
        payerPreimage: zapInvoice.preimage,
        privateKeyHex: '1'.repeat(64)
      })
    )
    expect(prismaMock.invoice.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zapReceiptEventId: 'receipt-event',
          zapReceiptJson: '{"kind":9735,"id":"receipt-event"}',
          zapReceiptLeaseOwner: null
        })
      })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
  })

  it('does not publish a zap receipt while the listener is disabled', async () => {
    listenerState.enabled = false
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(
      zapInvoice as never
    )

    await expect(publishInvoiceZapReceipt(zapInvoice.id)).resolves.toBe(
      'not-ready'
    )

    expect(publishZapReceiptMock).not.toHaveBeenCalled()
    expect(prismaMock.invoice.updateMany).not.toHaveBeenCalled()
  })
})
