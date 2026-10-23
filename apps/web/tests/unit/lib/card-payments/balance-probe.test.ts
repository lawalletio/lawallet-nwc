import { beforeEach, describe, expect, it, vi } from 'vitest'

const driverForWallet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet
}))

import { probeCardBalanceMsats } from '@/lib/card-payments/balance-probe'

const route = {
  kind: 'wallet' as const,
  walletId: 'wallet-1',
  type: 'NWC' as const,
  config: { mode: 'SEND_RECEIVE' as const }
}

function balance(balanceSats: number) {
  driverForWallet.mockReturnValue({
    driver: { getBalance: vi.fn().mockResolvedValue({ balanceSats }) },
    config: {}
  })
}

beforeEach(() => {
  driverForWallet.mockReset()
})

describe('probeCardBalanceMsats', () => {
  it('returns the live balance in msats', async () => {
    balance(12_345)

    await expect(probeCardBalanceMsats(route)).resolves.toBe(12_345_000)
  })

  it('reads the balance when the route has no wallet id', async () => {
    balance(8)

    await expect(
      probeCardBalanceMsats({ ...route, walletId: null })
    ).resolves.toBe(8_000)
    expect(driverForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ id: undefined })
    )
  })

  it('reports 0 when the wallet is empty or the balance is unusable', async () => {
    for (const balanceSats of [0, -5, 1.5, Number.POSITIVE_INFINITY]) {
      balance(balanceSats)
      await expect(probeCardBalanceMsats(route)).resolves.toBe(0)
    }
  })

  it('returns null when the balance cannot be represented in msats', async () => {
    balance(Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1)

    await expect(probeCardBalanceMsats(route)).resolves.toBeNull()
  })

  it('returns null when the wallet errors or the driver cannot be built', async () => {
    driverForWallet.mockReturnValue({
      driver: { getBalance: vi.fn().mockRejectedValue(new Error('down')) },
      config: {}
    })
    await expect(probeCardBalanceMsats(route)).resolves.toBeNull()

    driverForWallet.mockImplementation(() => {
      throw new Error('bad config')
    })
    await expect(probeCardBalanceMsats(route)).resolves.toBeNull()
  })

  it('gives up at the budget (600 ms by default, or the caller\'s)', async () => {
    vi.useFakeTimers()
    driverForWallet.mockReturnValue({
      driver: { getBalance: () => new Promise(() => {}) },
      config: {}
    })

    try {
      const byDefault = probeCardBalanceMsats(route)
      await vi.advanceTimersByTimeAsync(600)
      await expect(byDefault).resolves.toBeNull()

      const custom = probeCardBalanceMsats(route, 50)
      await vi.advanceTimersByTimeAsync(50)
      await expect(custom).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows a probe that rejects after the budget has already elapsed', async () => {
    vi.useFakeTimers()
    let rejectProbe: ((err: Error) => void) | undefined
    driverForWallet.mockReturnValue({
      driver: {
        getBalance: () =>
          new Promise((_, reject) => {
            rejectProbe = reject
          })
      },
      config: {}
    })

    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown) => {
      unhandled.push(err)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const pending = probeCardBalanceMsats(route)
      await vi.advanceTimersByTimeAsync(600)
      await expect(pending).resolves.toBeNull()
      rejectProbe?.(new Error('late balance failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      vi.useRealTimers()
    }
  })
})
