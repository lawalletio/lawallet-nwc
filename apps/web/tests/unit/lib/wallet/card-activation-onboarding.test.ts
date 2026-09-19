import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({}))
}))

vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  createLncurlRemoteWallet: vi.fn()
}))

vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet: vi.fn()
}))

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import { driverForWallet } from '@/lib/wallet/drivers'
import {
  deliverReservedSatsBonus,
  evaluateActivationBonuses,
  hasReservedFreeAddress,
  redeemFreeAddressReservation,
  reserveActivationBonuses,
  resolveClaimWallet
} from '@/lib/wallet/card-activation-onboarding'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getSettings).mockResolvedValue({})
})

describe('resolveClaimWallet', () => {
  it('binds an explicit ACTIVE wallet owned by the claimer', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w1',
      userId: 'user1',
      status: 'ACTIVE'
    } as any)

    await expect(
      resolveClaimWallet({ userId: 'user1', explicitWalletId: 'w1' })
    ).resolves.toBe('w1')
  })

  it('rejects an explicit wallet that is not the claimer\'s ACTIVE wallet', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'other',
      status: 'ACTIVE'
    } as any)

    await expect(
      resolveClaimWallet({ userId: 'user1', explicitWalletId: 'w2' })
    ).rejects.toThrow('Unknown or inactive wallet')
  })

  it('prefers the primary-address wallet over minting a new one', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'CUSTOM_NWC',
      remoteWalletId: 'primary-1',
      remoteWallet: { id: 'primary-1', status: 'ACTIVE' }
    } as any)

    await expect(resolveClaimWallet({ userId: 'user1' })).resolves.toBe(
      'primary-1'
    )
    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })

  it('falls back to any ACTIVE wallet, then LNCurl', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({
      id: 'active-1'
    } as any)

    await expect(resolveClaimWallet({ userId: 'user1' })).resolves.toBe(
      'active-1'
    )
    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })

  it('mints an LNCurl wallet when the claimer has none', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue({
      id: 'lncurl-1'
    } as any)

    await expect(resolveClaimWallet({ userId: 'user1' })).resolves.toBe(
      'lncurl-1'
    )
  })

  it('returns null when LNCurl minting fails', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null)
    vi.mocked(createLncurlRemoteWallet).mockRejectedValue(new Error('down'))

    await expect(resolveClaimWallet({ userId: 'user1' })).resolves.toBeNull()
  })
})

describe('evaluateActivationBonuses', () => {
  it('reserves a free address on a first claim for a user with no address', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue(null)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result).toEqual({
      freeLightningAddress: true,
      needsLightningAddress: true,
      sats: { eligible: false }
    })
  })

  it('does not grant a free address when the setting is off', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      card_free_ln_enabled: 'false'
    })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue(null)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.freeLightningAddress).toBe(false)
    expect(result.needsLightningAddress).toBe(true)
  })

  it('does not grant a free address when the card was already claimed', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue({
      id: 'old'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.freeLightningAddress).toBe(false)
  })

  it('does not grant a free address when the user already used the bonus', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue({
      id: 'used'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.freeLightningAddress).toBe(false)
  })

  it('does not steal eligibility from a user who already has an address', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      username: 'alice'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.freeLightningAddress).toBe(false)
    expect(result.needsLightningAddress).toBe(false)
  })

  it('marks sats eligible when configured and the card has no redeemed grant', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      card_sats_bonus_enabled: 'true',
      card_sats_bonus_amount: '500',
      card_sats_bonus_wallet_id: 'treasury-1'
    })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      username: 'alice'
    } as any)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'treasury-1',
      status: 'ACTIVE'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.sats).toEqual({
      eligible: true,
      amountSats: 500,
      sourceWalletId: 'treasury-1'
    })
    expect(result.freeLightningAddress).toBe(false)
  })

  it('does not mark sats eligible when the card already redeemed them', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      card_sats_bonus_enabled: 'true',
      card_sats_bonus_amount: '500',
      card_sats_bonus_wallet_id: 'treasury-1'
    })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'REDEEMED'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.sats.eligible).toBe(false)
  })

  it('keeps sats eligible when a reserved grant is still outstanding', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      card_sats_bonus_enabled: 'true',
      card_sats_bonus_amount: '500',
      card_sats_bonus_wallet_id: 'treasury-1'
    })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED'
    } as any)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'treasury-1',
      status: 'ACTIVE'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.sats.eligible).toBe(true)
  })

  it('does not mark sats eligible when the treasury wallet is inactive', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      card_sats_bonus_enabled: 'true',
      card_sats_bonus_amount: '500',
      card_sats_bonus_wallet_id: 'treasury-1'
    })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'treasury-1',
      status: 'DISABLED'
    } as any)

    const result = await evaluateActivationBonuses({
      userId: 'user1',
      cardId: 'card1'
    })

    expect(result.sats.eligible).toBe(false)
  })
})

describe('reserveActivationBonuses', () => {
  it('creates a free-address grant and upserts a sats grant', async () => {
    await reserveActivationBonuses(
      {
        userId: 'user1',
        cardId: 'card1',
        eligibility: {
          freeLightningAddress: true,
          needsLightningAddress: true,
          sats: {
            eligible: true,
            amountSats: 210,
            sourceWalletId: 'treasury-1'
          }
        }
      },
      prismaMock as any
    )

    expect(prismaMock.cardActivationBonus.create).toHaveBeenCalledWith({
      data: {
        cardId: 'card1',
        userId: 'user1',
        kind: 'FREE_ADDRESS',
        status: 'RESERVED'
      }
    })
    expect(prismaMock.cardActivationBonus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: 'SATS',
          amountSats: 210,
          sourceWalletId: 'treasury-1'
        })
      })
    )
  })

  it('does nothing when no bonus is eligible', async () => {
    await reserveActivationBonuses(
      {
        userId: 'user1',
        cardId: 'card1',
        eligibility: {
          freeLightningAddress: false,
          needsLightningAddress: false,
          sats: { eligible: false }
        }
      },
      prismaMock as any
    )

    expect(prismaMock.cardActivationBonus.create).not.toHaveBeenCalled()
    expect(prismaMock.cardActivationBonus.upsert).not.toHaveBeenCalled()
  })
})

describe('deliverReservedSatsBonus', () => {
  it('pays the reserved grant and marks it redeemed', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 21,
      sourceWalletId: 'treasury-1'
    } as any)
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) =>
        ({ id: where.id, status: 'ACTIVE', type: 'NWC', config: {} }) as any
    )
    const makeInvoice = vi.fn().mockResolvedValue({ bolt11: 'lnbc21' })
    const payInvoice = vi.fn().mockResolvedValue({ preimage: 'ff' })
    vi.mocked(driverForWallet).mockReturnValue({
      driver: { makeInvoice, payInvoice },
      config: { connectionString: 'nostr+walletconnect://x' }
    } as any)

    const result = await deliverReservedSatsBonus({
      cardId: 'card1',
      userWalletId: 'user-w1'
    })

    expect(result).toEqual({ granted: true, amountSats: 21 })
    expect(prismaMock.cardActivationBonus.update).toHaveBeenCalledWith({
      where: { id: 'sats-1' },
      data: { status: 'REDEEMED' }
    })
  })

  it('does not pay a redeemed grant again', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'REDEEMED',
      amountSats: 21
    } as any)

    const result = await deliverReservedSatsBonus({
      cardId: 'card1',
      userWalletId: 'user-w1'
    })

    expect(result).toEqual({ granted: false })
    expect(driverForWallet).not.toHaveBeenCalled()
  })

  it('does not pay when there is no grant or destination wallet', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue(null)

    await expect(
      deliverReservedSatsBonus({ cardId: 'card1', userWalletId: 'user-w1' })
    ).resolves.toEqual({ granted: false })

    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 21,
      sourceWalletId: 'treasury-1'
    } as any)

    await expect(
      deliverReservedSatsBonus({ cardId: 'card1', userWalletId: null })
    ).resolves.toEqual({ granted: false, amountSats: 21 })
    expect(driverForWallet).not.toHaveBeenCalled()
  })

  it('does not pay when the grant has no amount or source wallet', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 0,
      sourceWalletId: 'treasury-1'
    } as any)

    await expect(
      deliverReservedSatsBonus({ cardId: 'card1', userWalletId: 'user-w1' })
    ).resolves.toEqual({ granted: false, amountSats: 0 })
    expect(driverForWallet).not.toHaveBeenCalled()
  })

  it('leaves the grant reserved when the user wallet is inactive', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 21,
      sourceWalletId: 'treasury-1'
    } as any)
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) =>
        ({
          id: where.id,
          status: where.id === 'user-w1' ? 'DISABLED' : 'ACTIVE'
        }) as any
    )

    const result = await deliverReservedSatsBonus({
      cardId: 'card1',
      userWalletId: 'user-w1'
    })

    expect(result).toEqual({ granted: false, amountSats: 21 })
    expect(prismaMock.cardActivationBonus.update).not.toHaveBeenCalled()
  })

  it('leaves the grant reserved when the treasury or user wallet is inactive', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 21,
      sourceWalletId: 'treasury-1'
    } as any)
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) =>
        ({
          id: where.id,
          status: where.id === 'treasury-1' ? 'DISABLED' : 'ACTIVE'
        }) as any
    )

    const result = await deliverReservedSatsBonus({
      cardId: 'card1',
      userWalletId: 'user-w1'
    })

    expect(result).toEqual({ granted: false, amountSats: 21 })
    expect(prismaMock.cardActivationBonus.update).not.toHaveBeenCalled()
  })

  it('leaves the grant reserved when the payment fails', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValue({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 21,
      sourceWalletId: 'treasury-1'
    } as any)
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) =>
        ({ id: where.id, status: 'ACTIVE', type: 'NWC', config: {} }) as any
    )
    vi.mocked(driverForWallet).mockImplementation(() => {
      throw new Error('treasury empty')
    })

    const result = await deliverReservedSatsBonus({
      cardId: 'card1',
      userWalletId: 'user-w1'
    })

    expect(result).toEqual({ granted: false, amountSats: 21 })
    expect(prismaMock.cardActivationBonus.update).not.toHaveBeenCalled()
  })
})

describe('free address reservation', () => {
  it('reports and redeems a reserved grant', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue({
      id: 'grant-1'
    } as any)

    await expect(hasReservedFreeAddress('user1')).resolves.toBe(true)
    await expect(redeemFreeAddressReservation('user1')).resolves.toBe(true)
    expect(prismaMock.cardActivationBonus.update).toHaveBeenCalledWith({
      where: { id: 'grant-1' },
      data: { status: 'REDEEMED' }
    })
  })

  it('returns false when no reserved grant exists', async () => {
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue(null)

    await expect(hasReservedFreeAddress('user1')).resolves.toBe(false)
    await expect(redeemFreeAddressReservation('user1')).resolves.toBe(false)
    expect(prismaMock.cardActivationBonus.update).not.toHaveBeenCalled()
  })
})
