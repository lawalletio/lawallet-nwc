import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/lib/generated/prisma'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

/**
 * `Card_userId_master_unique` is a raw partial unique index — Prisma can't
 * express it, so the mocked integration tests can't prove it exists. These
 * exercise the real constraint: one MASTER per holder, unpaired cards exempt,
 * and demote-then-promote as the only ordering Postgres accepts.
 */
describe.skipIf(!runDatabaseTests)(
  'one MASTER card per holder, enforced by PostgreSQL',
  () => {
    let prisma: PrismaClient
    const suffix = randomUUID()
    const designId = `master-design-${suffix}`
    const userId = `master-user-${suffix}`
    const cardA = `master-card-a-${suffix}`
    const cardB = `master-card-b-${suffix}`

    beforeAll(async () => {
      if (!runDatabaseTests) return
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

      await prisma.cardDesign.create({
        data: {
          id: designId,
          imageUrl: 'https://example.test/card.png',
          description: 'Master card index test'
        }
      })
      await prisma.user.create({
        data: { id: userId, pubkey: randomUUID().replaceAll('-', '') }
      })
      await prisma.card.createMany({
        data: [
          { id: cardA, designId, userId, kind: 'SIMPLE' },
          { id: cardB, designId, userId, kind: 'SIMPLE' }
        ]
      })
    })

    afterAll(async () => {
      if (!runDatabaseTests || !prisma) return
      await prisma.card.deleteMany({ where: { designId } })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.cardDesign.deleteMany({ where: { id: designId } })
      await prisma.$disconnect()
    })

    it('rejects a second MASTER card for the same holder', async () => {
      await prisma.card.update({
        where: { id: cardA },
        data: { kind: 'MASTER' }
      })

      await expect(
        prisma.card.update({ where: { id: cardB }, data: { kind: 'MASTER' } })
      ).rejects.toMatchObject({ code: 'P2002' })

      // Reset for the following tests.
      await prisma.card.updateMany({
        where: { userId },
        data: { kind: 'SIMPLE' }
      })
    })

    it('accepts demote-then-promote inside one transaction', async () => {
      await prisma.card.update({
        where: { id: cardA },
        data: { kind: 'MASTER' }
      })

      await prisma.$transaction(async tx => {
        await tx.card.updateMany({
          where: { userId, kind: 'MASTER', id: { not: cardB } },
          data: { kind: 'SIMPLE' }
        })
        await tx.card.update({ where: { id: cardB }, data: { kind: 'MASTER' } })
      })

      const masters = await prisma.card.findMany({
        where: { userId, kind: 'MASTER' },
        select: { id: true }
      })
      expect(masters.map(card => card.id)).toEqual([cardB])

      await prisma.card.updateMany({
        where: { userId },
        data: { kind: 'SIMPLE' }
      })
    })

    it('a card handed to a second holder cannot arrive still MASTER', async () => {
      // The claim/activate/unpair paths all write `kind: 'SIMPLE'` alongside
      // the new `userId`. This proves why that matters: carrying MASTER across
      // an ownership change would hit the index the moment the new holder
      // already had one.
      const otherUserId = `master-user2-${suffix}`
      const otherCard = `master-card-c-${suffix}`
      await prisma.user.create({
        data: { id: otherUserId, pubkey: randomUUID().replaceAll('-', '') }
      })
      await prisma.card.create({
        data: { id: otherCard, designId, userId: otherUserId, kind: 'MASTER' }
      })
      // cardA is MASTER for its own holder; hand it to the other holder as-is.
      await prisma.card.update({
        where: { id: cardA },
        data: { kind: 'MASTER' }
      })

      await expect(
        prisma.card.update({
          where: { id: cardA },
          data: { userId: otherUserId }
        })
      ).rejects.toMatchObject({ code: 'P2002' })

      // What the routes actually do — reset in the same write — succeeds.
      await expect(
        prisma.card.update({
          where: { id: cardA },
          data: { userId: otherUserId, kind: 'SIMPLE' }
        })
      ).resolves.toMatchObject({ kind: 'SIMPLE' })

      await prisma.card.update({
        where: { id: cardA },
        data: { userId, kind: 'SIMPLE' }
      })
      await prisma.card.deleteMany({ where: { id: otherCard } })
      await prisma.user.deleteMany({ where: { id: otherUserId } })
    })

    it('allows many unpaired MASTER cards in inventory', async () => {
      const inventoryA = `master-inv-a-${suffix}`
      const inventoryB = `master-inv-b-${suffix}`

      // The index is scoped to `userId IS NOT NULL`, so bulk provisioning can
      // stamp as many MASTER cards as it likes before they find a holder.
      await expect(
        prisma.card.createMany({
          data: [
            { id: inventoryA, designId, kind: 'MASTER' },
            { id: inventoryB, designId, kind: 'MASTER' }
          ]
        })
      ).resolves.toMatchObject({ count: 2 })

      await prisma.card.deleteMany({
        where: { id: { in: [inventoryA, inventoryB] } }
      })
    })
  }
)
