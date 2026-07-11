import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/lib/generated/prisma'
import type {
  ClaimCardPaymentAttemptInput,
  ClaimCardPaymentAttemptResult
} from '@/lib/card-payments/attempts'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests =
  !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

describe.skipIf(!runDatabaseTests)(
  'atomic card payment claims against PostgreSQL',
  () => {
    let prisma: PrismaClient
    let claimCardPaymentAttempt: (
      input: ClaimCardPaymentAttemptInput
    ) => Promise<ClaimCardPaymentAttemptResult>
    const suffix = randomUUID()
    const designId = `card-payment-design-${suffix}`
    const cardId = `card-payment-card-${suffix}`
    const ntag424Cid = randomUUID().replaceAll('-', '').slice(0, 14)

    beforeAll(async () => {
      if (!databaseUrl || !runDatabaseTests) return
      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      })
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      ;({ claimCardPaymentAttempt } = await import(
        '@/lib/card-payments/attempts'
      ))

      await prisma.cardDesign.create({
        data: { id: designId, imageUrl: 'https://example.test/card.png', description: 'Concurrency test' }
      })
      await prisma.ntag424.create({
        data: {
          cid: ntag424Cid,
          k0: '00'.repeat(16),
          k1: '11'.repeat(16),
          k2: '22'.repeat(16),
          k3: '33'.repeat(16),
          k4: '44'.repeat(16),
          ctr: 0
        }
      })
      await prisma.card.create({
        data: { id: cardId, designId, ntag424Cid }
      })
    })

    afterAll(async () => {
      if (!databaseUrl || !runDatabaseTests || !prisma) return
      await prisma.cardPaymentAttempt.deleteMany({ where: { cardId } })
      await prisma.card.deleteMany({ where: { id: cardId } })
      await prisma.ntag424.deleteMany({ where: { cid: ntag424Cid } })
      await prisma.cardDesign.deleteMany({ where: { id: designId } })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
    })

    const input = (
      counter: number,
      paymentByte: string
    ): ClaimCardPaymentAttemptInput => ({
      cardId,
      ntag424Cid,
      counter,
      walletId: `wallet-${suffix}`,
      paymentHash: paymentByte.repeat(64),
      bolt11: `lnbc-postgres-${paymentByte}-${counter}`,
      amountMsats: 1_000,
      transport: 'DIRECT'
    })

    it('single-flights two simultaneous copies of the same callback', async () => {
      const [first, second] = await Promise.all([
        claimCardPaymentAttempt(input(1, 'a')),
        claimCardPaymentAttempt(input(1, 'a'))
      ])

      expect([first.outcome, second.outcome].sort()).toEqual([
        'CREATED',
        'EXISTING'
      ])
      expect(
        await prisma.cardPaymentAttempt.count({ where: { cardId } })
      ).toBe(1)
      const ntag = await prisma.ntag424.findUniqueOrThrow({
        where: { cid: ntag424Cid }
      })
      expect(ntag.ctr).toBe(1)
      expect(
        (await prisma.card.findUniqueOrThrow({ where: { id: cardId } }))
          .lastUsedAt
      ).not.toBeNull()
    })

    it('never regresses the counter or creates two unresolved attempts', async () => {
      await prisma.cardPaymentAttempt.updateMany({
        where: { cardId },
        data: { status: 'REJECTED', resolvedAt: new Date() }
      })

      const [counterTwo, counterThree] = await Promise.all([
        claimCardPaymentAttempt(input(2, 'b')),
        claimCardPaymentAttempt(input(3, 'c'))
      ])
      const created = [counterTwo, counterThree].find(
        result => result.outcome === 'CREATED'
      )
      expect(created?.outcome).toBe('CREATED')
      expect(
        await prisma.cardPaymentAttempt.count({
          where: { cardId, status: { in: ['PENDING', 'UNKNOWN'] } }
        })
      ).toBe(1)

      const storedAfterRace = await prisma.ntag424.findUniqueOrThrow({
        where: { cid: ntag424Cid }
      })
      expect(storedAfterRace.ctr).toBe(
        created?.outcome === 'CREATED' ? created.attempt.counter : 0
      )

      await prisma.cardPaymentAttempt.updateMany({
        where: { cardId, status: { in: ['PENDING', 'UNKNOWN'] } },
        data: { status: 'REJECTED', resolvedAt: new Date() }
      })
      await expect(claimCardPaymentAttempt(input(4, 'd'))).resolves.toMatchObject(
        { outcome: 'CREATED' }
      )
      expect(
        (await prisma.ntag424.findUniqueOrThrow({
          where: { cid: ntag424Cid }
        })).ctr
      ).toBe(4)
    })
  }
)
