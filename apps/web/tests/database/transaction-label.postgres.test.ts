import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPrismaClient } from '@/lib/create-prisma-client'
import type { PrismaClient } from '@/lib/generated/prisma'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)
const auth = vi.hoisted(() => ({ pubkey: '' }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    logLevel: 'silent',
    maintenance: { enabled: false },
    requestLimits: { maxJsonSize: 100_000 }
  })
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: async () => ({
    pubkey: auth.pubkey,
    role: 'USER',
    method: 'jwt'
  })
}))

describe.skipIf(!runDatabaseTests)(
  'private transaction labels against PostgreSQL',
  () => {
    let prisma: PrismaClient
    let route: typeof import('@/app/api/wallet/transactions/[paymentHash]/label/route')
    const accounts = [0, 1].map(() => ({
      id: `transaction-label-test-${randomUUID()}`,
      pubkey: randomBytes(32).toString('hex')
    }))
    const paymentHash = randomBytes(32).toString('hex')
    const path = `/api/wallet/transactions/${paymentHash}/label`
    const context = () => createParamsPromise({ paymentHash })

    beforeAll(async () => {
      prisma = createPrismaClient(databaseUrl!)
      await prisma.user.createMany({ data: accounts })
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      route =
        await import('@/app/api/wallet/transactions/[paymentHash]/label/route')
    })

    afterAll(async () => {
      if (!prisma) return
      // Delete only the fixture accounts created by this test; labels cascade.
      await prisma.user.deleteMany({
        where: { id: { in: accounts.map(a => a.id) } }
      })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
    })

    it('persists across connections and keeps counterpart annotations independent', async () => {
      async function save(label: string) {
        return assertResponse(
          await route.PUT(
            createNextRequest(path, { method: 'PUT', body: { label } }),
            context()
          ),
          200
        )
      }
      async function read() {
        return assertResponse(
          await route.GET(createNextRequest(path), context()),
          200
        )
      }

      auth.pubkey = accounts[0].pubkey
      expect(await save('  Personal budget  ')).toEqual({
        label: 'Personal budget'
      })
      await prisma.$disconnect()
      expect(await read()).toEqual({ label: 'Personal budget' })

      auth.pubkey = accounts[1].pubkey
      expect(await read()).toEqual({ label: null })
      expect(await save('Business')).toEqual({ label: 'Business' })

      auth.pubkey = accounts[0].pubkey
      expect(await save('Travel')).toEqual({ label: 'Travel' })
      expect(await read()).toEqual({ label: 'Travel' })
      expect(await save('')).toEqual({ label: null })
      expect(await read()).toEqual({ label: null })

      auth.pubkey = accounts[1].pubkey
      expect(await read()).toEqual({ label: 'Business' })
      expect(
        await prisma.transactionLabel.count({ where: { paymentHash } })
      ).toBe(1)
    })
  }
)
