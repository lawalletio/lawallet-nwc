import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const emitMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: emitMock } }))

import {
  expireStaleInvoices,
  STALE_INVOICE_GRACE_MS
} from '@/lib/maintenance/expire-invoices'

const now = new Date('2026-10-12T12:00:00Z')

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('expireStaleInvoices', () => {
  it('expires only unpaid, non-proxy invoices past expiry plus the grace', async () => {
    vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
      count: 3
    } as never)

    await expect(expireStaleInvoices(now)).resolves.toBe(3)

    expect(prismaMock.invoice.updateMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date(now.getTime() - STALE_INVOICE_GRACE_MS) },
        // The proxy state machine owns its own invoices' lifecycle.
        proxyPayment: null
      },
      data: { status: 'EXPIRED' },
      limit: 500
    })
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
  })

  it('drains a backlog in LIMITed batches until one comes back short', async () => {
    vi.mocked(prismaMock.invoice.updateMany)
      .mockResolvedValueOnce({ count: 500 } as never)
      .mockResolvedValueOnce({ count: 500 } as never)
      .mockResolvedValueOnce({ count: 12 } as never)

    await expect(expireStaleInvoices(now)).resolves.toBe(1012)
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledTimes(3)
  })

  it('bounds one tick to a fixed number of batches', async () => {
    vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
      count: 500
    } as never)

    await expect(expireStaleInvoices(now)).resolves.toBe(500 * 20)
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledTimes(20)
  })

  it('stays quiet when nothing expired', async () => {
    vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
      count: 0
    } as never)

    await expect(expireStaleInvoices(now)).resolves.toBe(0)
    expect(emitMock).not.toHaveBeenCalled()
  })
})
