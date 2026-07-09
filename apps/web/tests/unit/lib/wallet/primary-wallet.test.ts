import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  derivePrimaryWallet,
  derivePrimaryWalletId,
  syncPrimaryRemoteWalletFlag,
} from '@/lib/wallet/primary-wallet'

const USER_ID = 'user-1'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('primary-wallet helper', () => {
  it('derives the primary wallet from a primary CUSTOM_NWC address', () => {
    const wallet = { id: 'wallet-1' }
    const address = {
      mode: 'CUSTOM_NWC' as const,
      remoteWalletId: 'wallet-1',
      remoteWallet: wallet,
    }

    expect(derivePrimaryWalletId(address)).toBe('wallet-1')
    expect(derivePrimaryWallet(address)).toBe(wallet)
  })

  it('returns none for IDLE and ALIAS primary addresses', () => {
    expect(
      derivePrimaryWalletId({ mode: 'IDLE' as const, remoteWalletId: null }),
    ).toBeNull()
    expect(
      derivePrimaryWalletId({
        mode: 'ALIAS' as const,
        remoteWalletId: null,
      }),
    ).toBeNull()
  })

  it('syncs isDefault so only the primary-address wallet is flagged', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'CUSTOM_NWC',
      remoteWalletId: 'wallet-2',
    } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(syncPrimaryRemoteWalletFlag(USER_ID)).resolves.toBe('wallet-2')

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: USER_ID, isDefault: true, id: { not: 'wallet-2' } },
      data: { isDefault: false },
    })
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'wallet-2',
        userId: USER_ID,
        status: { notIn: ['REVOKED', 'DEAD'] },
      },
      data: { isDefault: true },
    })
  })

  it('clears all isDefault flags when the primary address has no wallet', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'IDLE',
      remoteWalletId: null,
    } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({ count: 2 } as never)

    await expect(syncPrimaryRemoteWalletFlag(USER_ID)).resolves.toBeNull()

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isDefault: true },
      data: { isDefault: false },
    })
  })
})
