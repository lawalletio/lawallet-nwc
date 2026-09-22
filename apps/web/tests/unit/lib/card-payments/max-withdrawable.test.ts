import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_WITHDRAW_BALANCE_FALLBACK_MSATS } from '@lawallet-nwc/shared'

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

beforeEach(() => {
  driverForWallet.mockReset()
})

describe('resolveCardMaxWithdrawableMsats', () => {
  it('advertises the live balance in msats', async () => {
    driverForWallet.mockReturnValue({
      driver: {
        getBalance: vi.fn().mockResolvedValue({ balanceSats: 12_345 })
      },
      config: {}
    })

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(
      12_345_000
    )
  })

  it('advertises nothing when the wallet is empty', async () => {
    driverForWallet.mockReturnValue({
      driver: { getBalance: vi.fn().mockResolvedValue({ balanceSats: 0 }) },
      config: {}
    })

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(0)
  })

  it('falls back to a high ceiling when the balance probe fails', async () => {
    driverForWallet.mockImplementation(() => {
      throw new Error('bad config')
    })

    await expect(resolveCardMaxWithdrawableMsats(route)).resolves.toBe(
      CARD_WITHDRAW_BALANCE_FALLBACK_MSATS
    )
  })

  it('falls back when the balance probe exceeds the tap budget', async () => {
    vi.useFakeTimers()
    driverForWallet.mockReturnValue({
      driver: { getBalance: () => new Promise(() => {}) },
      config: {}
    })

    const pending = resolveCardMaxWithdrawableMsats(route)
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(pending).resolves.toBe(CARD_WITHDRAW_BALANCE_FALLBACK_MSATS)
    vi.useRealTimers()
  })
})
