import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/lib/generated/prisma'
import { createPrismaClient } from '@/lib/create-prisma-client'
import type { TapCard } from '@/lib/card-payments/tap-card'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

const WALLET = { select: { id: true, type: true, config: true, status: true } }

/** The nested select the scan + callback used before `loadTapCard`. */
const NESTED_SELECT = {
  id: true,
  blockedAt: true,
  disabledAt: true,
  ntag424Cid: true,
  ntag424: { select: { cid: true, k1: true, k2: true, ctr: true } },
  remoteWallet: WALLET,
  user: {
    select: {
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        select: { mode: true, remoteWalletId: true, remoteWallet: WALLET }
      }
    }
  }
} as const

describe.skipIf(!runDatabaseTests)(
  'loadTapCard matches the nested Prisma select',
  () => {
    let prisma: PrismaClient
    let loadTapCard: (cardId: string) => Promise<TapCard | null>
    const s = randomUUID().slice(0, 8)
    const userId = `tap-user-${s}`
    const designId = `tap-design-${s}`
    const cid = randomUUID().replaceAll('-', '').slice(0, 14)
    const cards = {
      full: `tap-full-${s}`,
      bare: `tap-bare-${s}`,
      noPrimary: `tap-noprimary-${s}`
    }

    beforeAll(async () => {
      if (!databaseUrl || !runDatabaseTests) return
      prisma = createPrismaClient(databaseUrl)
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      ;({ loadTapCard } = await import('@/lib/card-payments/tap-card'))

      await prisma.user.create({ data: { id: userId, pubkey: `pk-${s}` } })
      const [bound, primary] = await Promise.all(
        ['bound', 'primary'].map(name =>
          prisma.remoteWallet.create({
            data: {
              userId,
              name,
              type: 'NWC',
              config: { connectionString: `nwc-${name}`, mode: 'SEND_RECEIVE' }
            }
          })
        )
      )
      await prisma.lightningAddress.createMany({
        data: [
          {
            username: `tap-primary-${s}`,
            userId,
            mode: 'CUSTOM_NWC',
            remoteWalletId: primary.id,
            isPrimary: true
          },
          { username: `tap-other-${s}`, userId, isPrimary: false }
        ]
      })
      const otherUserId = `tap-user2-${s}`
      await prisma.user.create({
        data: { id: otherUserId, pubkey: `pk2-${s}` }
      })
      await prisma.lightningAddress.create({
        data: { username: `tap-u2-${s}`, userId: otherUserId }
      })
      await prisma.cardDesign.create({
        data: {
          id: designId,
          imageUrl: 'https://x.test/c.png',
          description: ''
        }
      })
      await prisma.ntag424.create({
        data: {
          cid,
          k0: '00'.repeat(16),
          k1: '11'.repeat(16),
          k2: '22'.repeat(16),
          k3: '33'.repeat(16),
          k4: '44'.repeat(16),
          ctr: 7
        }
      })
      await prisma.card.createMany({
        data: [
          {
            id: cards.full,
            designId,
            ntag424Cid: cid,
            userId,
            remoteWalletId: bound.id,
            blockedAt: new Date('2026-01-02T03:04:05.678Z')
          },
          { id: cards.bare, designId },
          { id: cards.noPrimary, designId, userId: otherUserId }
        ]
      })
    })

    afterAll(async () => {
      if (!databaseUrl || !runDatabaseTests || !prisma) return
      await prisma.card.deleteMany({
        where: { id: { in: Object.values(cards) } }
      })
      await prisma.ntag424.deleteMany({ where: { cid } })
      await prisma.cardDesign.deleteMany({ where: { id: designId } })
      await prisma.user.deleteMany({
        where: { id: { in: [userId, `tap-user2-${s}`] } }
      })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
    })

    it.each(Object.keys(cards) as Array<keyof typeof cards>)(
      'returns the same shape for the %s card',
      async key => {
        const expected = await prisma.card.findUnique({
          where: { id: cards[key] },
          select: NESTED_SELECT
        })
        expect(expected).not.toBeNull()
        expect(await loadTapCard(cards[key])).toEqual(expected)
      }
    )

    it('returns null for an unknown card', async () => {
      expect(await loadTapCard(`missing-${s}`)).toBeNull()
    })
  }
)
