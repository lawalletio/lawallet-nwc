import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isDevelopment: false, isTest: true }))
}))

import {
  reconcileWalletNames,
  reparentAccountResources,
  type ReparentParams
} from '@/lib/account/reparent'

const FROM = 'user-from'
const TO = 'user-to'

const tx = prismaMock as any

/** Every model that must travel with the account, in the helper's order. */
const REPARENTED_MODELS = [
  'lightningAddress',
  'remoteWallet',
  'card',
  'ntag424',
  'cardDesign',
  'invoice',
  'activityLog',
  'voucher',
  'voucherTransfer',
  'remoteWalletForwardReceipt',
  'remoteWalletNotificationDelivery',
  'cardActivationBonus'
] as const

/** Login material and the User row stay where they are. */
const UNTOUCHED_MODELS = [
  'nostrIdentity',
  'passkeyCredential',
  'managedNostrKey',
  'oAuthGrant',
  'mcpPayment',
  'user',
  'accountRecovery'
] as const

function params(overrides: Partial<ReparentParams> = {}): ReparentParams {
  return {
    fromId: FROM,
    toId: TO,
    target: { hasPrimaryAddress: false, hasDefaultWallet: false },
    incoming: { hasPrimaryAddress: false, wallets: [] },
    ...overrides
  }
}

/** The `{ userId: FROM } → { userId: TO }` re-parent call on a model. */
function reparentCall(model: string) {
  const fn = tx[model].updateMany as ReturnType<typeof vi.fn>
  const index = fn.mock.calls.findIndex(
    ([arg]: any[]) =>
      arg?.where?.userId === FROM &&
      Object.keys(arg.where).length === 1 &&
      arg?.data?.userId === TO
  )
  return index === -1 ? null : fn.mock.invocationCallOrder[index]
}

/** invocationCallOrder of the first call matching `args` exactly. */
function callOrder(fn: ReturnType<typeof vi.fn>, args: unknown): number {
  const index = fn.mock.calls.findIndex(
    ([arg]: any[]) => JSON.stringify(arg) === JSON.stringify(args)
  )
  expect(index, `expected a call with ${JSON.stringify(args)}`).not.toBe(-1)
  return fn.mock.invocationCallOrder[index]
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  for (const model of REPARENTED_MODELS) {
    vi.mocked(tx[model].updateMany).mockResolvedValue({ count: 0 })
  }
  vi.mocked(prismaMock.lightningAddress.updateMany).mockResolvedValue({
    count: 2
  } as any)
  vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
    count: 3
  } as any)
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([])
  vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null)
  vi.mocked(prismaMock.transactionLabel.findMany).mockResolvedValue([])
})

describe('reparentAccountResources', () => {
  it('re-parents every owned model from the source to the target', async () => {
    await reparentAccountResources(tx, params())

    for (const model of REPARENTED_MODELS) {
      expect(tx[model].updateMany, model).toHaveBeenCalledWith({
        where: { userId: FROM },
        data: { userId: TO }
      })
    }
  })

  it('moves wallet history and the activation bonus record', async () => {
    await reparentAccountResources(tx, params())

    expect(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).toHaveBeenCalledWith({ where: { userId: FROM }, data: { userId: TO } })
    expect(
      prismaMock.remoteWalletNotificationDelivery.updateMany
    ).toHaveBeenCalledWith({ where: { userId: FROM }, data: { userId: TO } })
    expect(prismaMock.cardActivationBonus.updateMany).toHaveBeenCalledWith({
      where: { userId: FROM },
      data: { userId: TO }
    })
  })

  describe('private transaction tags', () => {
    it('re-inserts them under the target and drops the source rows', async () => {
      vi.mocked(prismaMock.transactionLabel.findMany).mockResolvedValue([
        { paymentHash: 'shared-payment', label: 'From source' },
        { paymentHash: 'source-only', label: 'Travel' }
      ] as any)

      await reparentAccountResources(tx, params())

      expect(prismaMock.transactionLabel.findMany).toHaveBeenCalledWith({
        where: { userId: FROM },
        select: { paymentHash: true, label: true }
      })
      // skipDuplicates keeps the target's own tag on a payment both annotated.
      expect(prismaMock.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [
          { userId: TO, paymentHash: 'shared-payment', label: 'From source' },
          { userId: TO, paymentHash: 'source-only', label: 'Travel' }
        ],
        skipDuplicates: true
      })
      expect(prismaMock.transactionLabel.deleteMany).toHaveBeenCalledWith({
        where: { userId: FROM }
      })
    })

    it('writes nothing when the source has no tags', async () => {
      await reparentAccountResources(tx, params())

      expect(prismaMock.transactionLabel.createMany).not.toHaveBeenCalled()
      expect(prismaMock.transactionLabel.deleteMany).not.toHaveBeenCalled()
    })
  })

  it('returns the moved address and wallet counts', async () => {
    const result = await reparentAccountResources(tx, params())
    expect(result).toEqual({ movedAddresses: 2, movedWallets: 3 })
  })

  it('leaves login material and the User row alone', async () => {
    await reparentAccountResources(tx, params())

    for (const model of UNTOUCHED_MODELS) {
      for (const method of ['update', 'updateMany', 'delete', 'deleteMany']) {
        expect(tx[model][method], `${model}.${method}`).not.toHaveBeenCalled()
      }
    }
  })

  describe('primary address', () => {
    it('clears the incoming isPrimary before the move when the target has one', async () => {
      await reparentAccountResources(
        tx,
        params({
          target: { hasPrimaryAddress: true, hasDefaultWallet: false },
          incoming: { hasPrimaryAddress: true, wallets: [] }
        })
      )

      const clear = callOrder(
        vi.mocked(prismaMock.lightningAddress.updateMany),
        { where: { userId: FROM, isPrimary: true }, data: { isPrimary: false } }
      )
      expect(clear).toBeLessThan(reparentCall('lightningAddress')!)
      // Never the target's own flag.
      expect(prismaMock.lightningAddress.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: TO, isPrimary: true } })
      )
    })

    it('lets the incoming primary through when the target has none', async () => {
      await reparentAccountResources(
        tx,
        params({
          target: { hasPrimaryAddress: false, hasDefaultWallet: false },
          incoming: { hasPrimaryAddress: true, wallets: [] }
        })
      )

      expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledTimes(1)
      expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
        where: { userId: FROM },
        data: { userId: TO }
      })
    })
  })

  describe('default wallet', () => {
    const clearIncoming = {
      where: { userId: FROM, isDefault: true },
      data: { isDefault: false }
    }
    const clearTarget = {
      where: { userId: TO, isDefault: true },
      data: { isDefault: false }
    }

    it.each([
      {
        name: 'target has a primary address, incoming has one too',
        target: { hasPrimaryAddress: true, hasDefaultWallet: true },
        incomingPrimary: true,
        expected: 'incoming'
      },
      {
        name: 'target has a primary address, incoming has none',
        target: { hasPrimaryAddress: true, hasDefaultWallet: true },
        incomingPrimary: false,
        expected: 'incoming'
      },
      {
        name: 'neither side has a primary address',
        target: { hasPrimaryAddress: false, hasDefaultWallet: true },
        incomingPrimary: false,
        expected: 'incoming'
      },
      {
        name: 'only the incoming account has a primary address',
        target: { hasPrimaryAddress: false, hasDefaultWallet: true },
        incomingPrimary: true,
        expected: 'target'
      },
      {
        name: 'the target has no default wallet at all',
        target: { hasPrimaryAddress: false, hasDefaultWallet: false },
        incomingPrimary: true,
        expected: 'neither'
      },
      {
        // The target's primary wins, so the incoming default must not
        // arrive still flagged and disagree with that binding.
        name: 'the target has no default wallet but has a primary address',
        target: { hasPrimaryAddress: true, hasDefaultWallet: false },
        incomingPrimary: false,
        expected: 'incoming'
      },
      {
        name: 'both have a primary address, the target has no default wallet',
        target: { hasPrimaryAddress: true, hasDefaultWallet: false },
        incomingPrimary: true,
        expected: 'incoming'
      },
      {
        name: 'neither side has a primary address nor a target default',
        target: { hasPrimaryAddress: false, hasDefaultWallet: false },
        incomingPrimary: false,
        expected: 'neither'
      }
    ])(
      '$name → clears $expected default',
      async ({ target, incomingPrimary, expected }) => {
        await reparentAccountResources(
          tx,
          params({
            target,
            incoming: { hasPrimaryAddress: incomingPrimary, wallets: [] }
          })
        )

        const updateMany = vi.mocked(prismaMock.remoteWallet.updateMany)
        if (expected === 'incoming') {
          expect(updateMany).toHaveBeenCalledWith(clearIncoming)
          expect(updateMany).not.toHaveBeenCalledWith(clearTarget)
          expect(callOrder(updateMany, clearIncoming)).toBeLessThan(
            reparentCall('remoteWallet')!
          )
        } else if (expected === 'target') {
          expect(updateMany).toHaveBeenCalledWith(clearTarget)
          expect(updateMany).not.toHaveBeenCalledWith(clearIncoming)
          // Cleared before the incoming default lands under the same user.
          expect(callOrder(updateMany, clearTarget)).toBeLessThan(
            reparentCall('remoteWallet')!
          )
        } else {
          expect(updateMany).not.toHaveBeenCalledWith(clearIncoming)
          expect(updateMany).not.toHaveBeenCalledWith(clearTarget)
        }
      }
    )
  })

  describe('MASTER card', () => {
    it('looks up the target MASTER', async () => {
      await reparentAccountResources(tx, params())
      expect(prismaMock.card.findFirst).toHaveBeenCalledWith({
        where: { userId: TO, kind: 'MASTER' },
        select: { id: true }
      })
    })

    it('demotes the incoming MASTER to SIMPLE before the move on a clash', async () => {
      vi.mocked(prismaMock.card.findFirst).mockResolvedValue({
        id: 'target-master'
      } as any)

      await reparentAccountResources(tx, params())

      const demote = callOrder(vi.mocked(prismaMock.card.updateMany), {
        where: { userId: FROM, kind: 'MASTER' },
        data: { kind: 'SIMPLE' }
      })
      expect(demote).toBeLessThan(reparentCall('card')!)
    })

    it('keeps the incoming MASTER when the target has none', async () => {
      await reparentAccountResources(tx, params())

      expect(prismaMock.card.updateMany).toHaveBeenCalledTimes(1)
      expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
        where: { userId: FROM },
        data: { userId: TO }
      })
    })
  })

  it('renames colliding incoming wallets before they move', async () => {
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
      { name: 'NWC Wallet' }
    ] as any)

    await reparentAccountResources(
      tx,
      params({
        incoming: {
          hasPrimaryAddress: false,
          wallets: [{ id: 'wb-1', name: 'NWC Wallet' }]
        }
      })
    )

    const rename = callOrder(vi.mocked(prismaMock.remoteWallet.update), {
      where: { id: 'wb-1' },
      data: { name: 'NWC Wallet (2)' }
    })
    expect(rename).toBeLessThan(reparentCall('remoteWallet')!)
  })
})

describe('reconcileWalletNames', () => {
  function seedTarget(names: string[]) {
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue(
      names.map(name => ({ name })) as any
    )
  }

  function renames() {
    return vi
      .mocked(prismaMock.remoteWallet.update)
      .mock.calls.map(([arg]: any[]) => [arg.where.id, arg.data.name])
  }

  it("reads only the target's wallet names", async () => {
    seedTarget([])
    await reconcileWalletNames(tx, TO, [])
    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith({
      where: { userId: TO },
      select: { name: true }
    })
  })

  it('renames nothing when no name collides', async () => {
    seedTarget(['Main'])
    await reconcileWalletNames(tx, TO, [{ id: 'w1', name: 'Savings' }])
    expect(prismaMock.remoteWallet.update).not.toHaveBeenCalled()
  })

  it('suffixes a colliding name with (2)', async () => {
    seedTarget(['Main'])
    await reconcileWalletNames(tx, TO, [{ id: 'w1', name: 'Main' }])
    expect(renames()).toEqual([['w1', 'Main (2)']])
  })

  it('skips a suffix the target already uses', async () => {
    seedTarget(['Main', 'Main (2)', 'Main (3)'])
    await reconcileWalletNames(tx, TO, [{ id: 'w1', name: 'Main' }])
    expect(renames()).toEqual([['w1', 'Main (4)']])
  })

  it('skips a suffix another incoming wallet already uses', async () => {
    seedTarget(['Main'])
    await reconcileWalletNames(tx, TO, [
      { id: 'w1', name: 'Main' },
      { id: 'w2', name: 'Main (2)' }
    ])
    // 'Main (2)' is taken by w2, which itself doesn't collide with the target.
    expect(renames()).toEqual([['w1', 'Main (3)']])
  })

  it('renames every colliding wallet with a distinct name', async () => {
    seedTarget(['A', 'B', 'LNCurl wallet'])
    await reconcileWalletNames(tx, TO, [
      { id: 'w1', name: 'A' },
      { id: 'w2', name: 'B' },
      { id: 'w3', name: 'C' },
      { id: 'w4', name: 'LNCurl wallet' }
    ])
    expect(renames()).toEqual([
      ['w1', 'A (2)'],
      ['w2', 'B (2)'],
      ['w4', 'LNCurl wallet (2)']
    ])
  })
})
