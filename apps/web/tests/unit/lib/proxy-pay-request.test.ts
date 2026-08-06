import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const { makeInvoice, fetchDestinationMetadata, requestDestinationInvoice } =
  vi.hoisted(() => ({
    makeInvoice: vi.fn(),
    fetchDestinationMetadata: vi.fn(),
    requestDestinationInvoice: vi.fn()
  }))

vi.mock('@/lib/proxy/config', () => ({
  getActiveProxyConfig: vi.fn(async () => ({
    row: { id: 'default', feeBps: 50 },
    connectionString:
      'nostr+walletconnect://' +
      'a'.repeat(64) +
      '?relay=wss%3A%2F%2Frelay.example&secret=' +
      'b'.repeat(64),
    receiptPrivateKey: 'c'.repeat(64)
  }))
}))

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({ enabled: true }))
}))

vi.mock('@/lib/proxy/lnurl', () => ({
  fetchDestinationMetadata,
  requestDestinationInvoice
}))

vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet: vi.fn(() => ({
    driver: { makeInvoice },
    config: { connectionString: 'nwc', mode: 'SEND_RECEIVE' }
  }))
}))

vi.mock('@/lib/invoice-utils', () => ({
  parseExactPaymentInvoice: vi.fn(() => ({
    amountMsats: 100_000,
    paymentHash: 'a'.repeat(64),
    expiresAt: Date.now() + 60_000,
    descriptionHash: null
  }))
}))

import { createProxyPayRequest } from '@/lib/proxy/pay-request'

describe('createProxyPayRequest', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
    fetchDestinationMetadata.mockResolvedValue({
      tag: 'payRequest',
      callback: 'https://destination.example/cb',
      minSendable: 1_000,
      maxSendable: 1_000_000,
      metadata: '[]',
      commentAllowed: 200
    })
    makeInvoice.mockResolvedValue({
      bolt11: 'lnbc1payer',
      paymentHash: 'a'.repeat(64),
      amountMsats: 100_000,
      amountSats: 100,
      description: '',
      expiresAt: Date.now() + 60_000
    })
    vi.mocked(prismaMock.proxyInvoiceIntent.create).mockResolvedValue({
      id: 'intent-1'
    } as never)
    vi.mocked(prismaMock.invoice.create).mockResolvedValue({
      id: 'invoice-1'
    } as never)
    vi.mocked(prismaMock.proxyPayment.create).mockResolvedValue({
      id: 'proxy-payment-1'
    } as never)
    vi.mocked(prismaMock.proxyInvoiceIntent.delete).mockResolvedValue(
      {} as never
    )
  })

  it('stores the intent before issuing only the payer-facing invoice', async () => {
    const result = await createProxyPayRequest({
      username: 'alice',
      userId: 'user-1',
      destination: 'bob@destination.example',
      blockedHosts: ['lawallet.example'],
      amountMsats: 100_000,
      comment: 'hello'
    })

    expect(result.proxyPaymentId).toBe('proxy-payment-1')
    expect(fetchDestinationMetadata).toHaveBeenCalledOnce()
    expect(requestDestinationInvoice).not.toHaveBeenCalled()
    expect(
      vi.mocked(prismaMock.proxyInvoiceIntent.create).mock
        .invocationCallOrder[0]
    ).toBeLessThan(makeInvoice.mock.invocationCallOrder[0])
    expect(prismaMock.proxyPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grossAmountMsats: BigInt(100_000),
        serviceFeeMsats: BigInt(500),
        destinationAmountMsats: BigInt(99_500),
        feeBps: 50,
        comment: 'hello'
      })
    })
  })
})
