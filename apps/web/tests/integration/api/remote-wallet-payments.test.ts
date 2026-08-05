import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn().mockResolvedValue({ pubkey: 'a'.repeat(64) })
}))
vi.mock('@/lib/auth/account', () => ({
  resolveAccountId: vi.fn().mockResolvedValue('user-1')
}))
vi.mock('@/lib/remote-wallet-forwarding/service', () => ({
  loadOwnedRemoteWallet: vi.fn().mockResolvedValue({ id: 'wallet-1' })
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (handler: unknown) => handler
}))

import { GET } from '@/app/api/remote-wallets/[id]/payments/[paymentHash]/route'

const HASH = 'a'.repeat(64)

beforeEach(() => resetPrismaMock())

describe('GET /api/remote-wallets/[id]/payments/[paymentHash]', () => {
  it('returns the owner-scoped zap request and published receipt', async () => {
    vi.mocked(prismaMock.invoice.findFirst).mockResolvedValue({
      zapRequest: { kind: 9734 },
      zapRequestJson: '{"kind":9734}',
      zapReceipt: { kind: 9735 },
      zapReceiptJson: '{"kind":9735}',
      zapReceiptEventId: 'receipt-event',
      zapReceiptPublishedAt: new Date('2026-08-03T12:00:00.000Z'),
      zapReceiptError: null,
      zapReceiptNextRetryAt: null
    } as never)

    const response = await GET(
      createNextRequest(`/api/remote-wallets/wallet-1/payments/${HASH}`),
      createParamsPromise({ id: 'wallet-1', paymentHash: HASH })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      zap: {
        request: { kind: 9734 },
        requestJson: '{"kind":9734}',
        receipt: { kind: 9735 },
        receiptJson: '{"kind":9735}',
        receiptEventId: 'receipt-event',
        receiptPublishedAt: '2026-08-03T12:00:00.000Z',
        error: null,
        nextRetryAt: null
      }
    })
    expect(prismaMock.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paymentHash: HASH,
          remoteWalletId: 'wallet-1',
          userId: 'user-1'
        }
      })
    )
  })

  it('returns an empty zap envelope for regular wallet payments', async () => {
    vi.mocked(prismaMock.invoice.findFirst).mockResolvedValue(null)

    const response = await GET(
      createNextRequest(`/api/remote-wallets/wallet-1/payments/${HASH}`),
      createParamsPromise({ id: 'wallet-1', paymentHash: HASH })
    )

    await expect(response.json()).resolves.toEqual({ zap: null })
  })
})
