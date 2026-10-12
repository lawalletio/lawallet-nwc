import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { loadTapCard } from '@/lib/card-payments/tap-card'

// Row → nested-shape mapping only. The SQL itself is checked against real
// Postgres in tests/database/tap-card.postgres.test.ts.

const blockedAt = new Date('2026-01-02T03:04:05.678Z')

const row = {
  id: 'card-1',
  userId: 'user-1',
  blockedAt,
  disabledAt: null,
  ntag424Cid: 'cid-1',
  ntagCid: 'cid-1',
  k1: '11',
  k2: '22',
  ctr: 7,
  cardWalletId: 'wallet-card',
  cardWalletType: 'NWC',
  cardWalletConfig: { mode: 'SEND_RECEIVE' },
  cardWalletStatus: 'ACTIVE',
  addressMode: 'CUSTOM_NWC',
  addressWalletId: 'wallet-primary',
  primaryWalletId: 'wallet-primary',
  primaryWalletType: 'NWC',
  primaryWalletConfig: { mode: 'RECEIVE' },
  primaryWalletStatus: 'PAUSED'
}

const empty = {
  ...row,
  userId: null,
  blockedAt: null,
  ntag424Cid: null,
  ntagCid: null,
  k1: null,
  k2: null,
  ctr: null,
  cardWalletId: null,
  cardWalletType: null,
  cardWalletConfig: null,
  cardWalletStatus: null,
  addressMode: null,
  addressWalletId: null,
  primaryWalletId: null,
  primaryWalletType: null,
  primaryWalletConfig: null,
  primaryWalletStatus: null
}

describe('loadTapCard', () => {
  beforeEach(() => resetPrismaMock())

  it('maps a fully linked card to the nested select shape', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([row])

    expect(await loadTapCard('card-1')).toEqual({
      id: 'card-1',
      blockedAt,
      disabledAt: null,
      ntag424Cid: 'cid-1',
      ntag424: { cid: 'cid-1', k1: '11', k2: '22', ctr: 7 },
      remoteWallet: {
        id: 'wallet-card',
        type: 'NWC',
        config: { mode: 'SEND_RECEIVE' },
        status: 'ACTIVE'
      },
      user: {
        lightningAddresses: [
          {
            mode: 'CUSTOM_NWC',
            remoteWalletId: 'wallet-primary',
            remoteWallet: {
              id: 'wallet-primary',
              type: 'NWC',
              config: { mode: 'RECEIVE' },
              status: 'PAUSED'
            }
          }
        ]
      }
    })
  })

  it('maps missing relations to null', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([empty])

    expect(await loadTapCard('card-1')).toEqual({
      id: 'card-1',
      blockedAt: null,
      disabledAt: null,
      ntag424Cid: null,
      ntag424: null,
      remoteWallet: null,
      user: null
    })
  })

  it('gives an owner with no primary address an empty list', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      { ...empty, userId: 'user-1' }
    ])

    expect((await loadTapCard('card-1'))?.user).toEqual({
      lightningAddresses: []
    })
  })

  it('keeps a primary address whose wallet was deleted', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      { ...empty, userId: 'user-1', addressMode: 'IDLE' }
    ])

    expect((await loadTapCard('card-1'))?.user).toEqual({
      lightningAddresses: [
        { mode: 'IDLE', remoteWalletId: null, remoteWallet: null }
      ]
    })
  })

  it('returns null for an unknown card', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([])

    expect(await loadTapCard('missing')).toBeNull()
  })
})
