import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import {
  holdsProtectedBalance,
  recordWalletBalance
} from '@/lib/wallet/last-balance'
import { logger } from '@/lib/logger'

function received(sats: number | null) {
  vi.mocked(prismaMock.invoice.aggregate).mockResolvedValue({
    _sum: { amountSats: sats }
  } as never)
}

describe('holdsProtectedBalance', () => {
  beforeEach(() => {
    resetPrismaMock()
    received(null)
  })

  it('protects a wallet whose last reading is over the threshold', async () => {
    const wallet = { id: 'w', lastBalanceSats: 6, lastBalanceAt: new Date() }
    await expect(holdsProtectedBalance(wallet)).resolves.toBe(true)
    expect(prismaMock.invoice.aggregate).not.toHaveBeenCalled()
  })

  it('counts only payments received after the last reading', async () => {
    const at = new Date('2026-10-27T00:00:00Z')
    received(3)
    const wallet = { id: 'w', lastBalanceSats: 2, lastBalanceAt: at }
    await expect(holdsProtectedBalance(wallet)).resolves.toBe(false)
    expect(prismaMock.invoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { remoteWalletId: 'w', status: 'PAID', paidAt: { gt: at } }
      })
    )
  })

  it('protects a never-read wallet by everything it ever received', async () => {
    received(12_140)
    const wallet = { id: 'w', lastBalanceSats: null, lastBalanceAt: null }
    await expect(holdsProtectedBalance(wallet)).resolves.toBe(true)
    expect(prismaMock.invoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { remoteWalletId: 'w', status: 'PAID' }
      })
    )
  })

  it('lets an empty, never-paid wallet go', async () => {
    const wallet = { id: 'w', lastBalanceSats: null, lastBalanceAt: null }
    await expect(holdsProtectedBalance(wallet)).resolves.toBe(false)
  })
})

describe('recordWalletBalance', () => {
  beforeEach(() => resetPrismaMock())

  it('skips readings that are not a non-negative integer', async () => {
    await recordWalletBalance('w', -1)
    await recordWalletBalance('w', 1.5)
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it('swallows a failed write so the balance read still succeeds', async () => {
    vi.mocked(prismaMock.$executeRaw).mockRejectedValue(new Error('db down'))
    await expect(recordWalletBalance('w', 100)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'w' }),
      'wallet.last_balance_write_failed'
    )
  })
})
