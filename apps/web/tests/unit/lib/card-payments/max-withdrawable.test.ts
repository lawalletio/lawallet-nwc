import { beforeEach, describe, expect, it, vi } from 'vitest'

const driverForWallet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet
}))

import { resolveCardMaxWithdrawableMsats } from '@/lib/card-payments/max-withdrawable'

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

describe('resolveCardMaxWithdrawableMsats', () => {
  it('advertises the live balance in msats', async () => {
    balance(12_345)

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(
      12_345_000
    )
  })

  it('reads the balance when the route has no wallet id', async () => {
    balance(8)

    await expect(
      resolveCardMaxWithdrawableMsats({ ...route, walletId: null })
    ).resolves.toBe(8_000)
    expect(driverForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ id: undefined })
    )
  })

  it('advertises nothing when the wallet is empty or the balance is unusable', async () => {
    for (const balanceSats of [0, -5, 1.5, Number.POSITIVE_INFINITY]) {
      balance(balanceSats)
      await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(0)
    }
  })

  it('advertises a high ceiling when the balance cannot be represented in msats', async () => {
    balance(Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1)

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('falls back to a high ceiling when the balance probe fails', async () => {
    driverForWallet.mockImplementation(() => {
      throw new Error('bad config')
    })

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('falls back when the balance probe exceeds the tap budget', async () => {
    vi.useFakeTimers()
    driverForWallet.mockReturnValue({
      driver: { getBalance: () => new Promise(() => {}) },
      config: {}
    })

    try {
      const pending = resolveCardMaxWithdrawableMsats(route)
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(pending).resolves.toBe(Number.MAX_SAFE_INTEGER)
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows a probe that rejects after the tap budget has already elapsed', async () => {
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
      const pending = resolveCardMaxWithdrawableMsats(route)
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(pending).resolves.toBe(Number.MAX_SAFE_INTEGER)
      rejectProbe?.(new Error('late balance failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      vi.useRealTimers()
    }
  })
})
