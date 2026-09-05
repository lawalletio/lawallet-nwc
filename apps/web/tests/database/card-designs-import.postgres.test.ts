import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { Role } from '@/lib/auth/permissions'

// Real-DB idempotency test for POST /api/card-designs/import.
//
// The mocked integration suite (tests/integration/api/card-designs.test.ts)
// proves the dedup-query scoping fix, but the Prisma mock can't reproduce a
// real `PrismaClientKnownRequestError` P2002 — only the route's dedup logic.
// This test drives the actual route handler against a real Postgres
// primary-key constraint (the genuine failure mode the bug report describes:
// "Sync designs works once then 500s on retries"), confirming the fix makes a
// re-sync return 200 with imported: 0 instead of colliding on the `id` PK.
//
// Gated exactly like the other *.postgres.test.ts files: requires
// CARD_PAYMENT_TEST_DATABASE_URL pointing at a DB whose name ends in _test
// or _e2e, so this is a no-op in the default `pnpm test` run.

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// Real PrismaClient pointed at the disposable test DB. The factory is async
// and lazy: it only runs when `@/lib/prisma` is first imported by the route,
// by which point `@/lib/generated/prisma` is resolvable. Both the test (below)
// and the route resolve to the same mocked module instance, so cleanup here
// acts on the same rows the route wrote.
//
// When CARD_PAYMENT_TEST_DATABASE_URL is unset the describe is skipped, so the
// route is never invoked — return a placeholder so `new PrismaClient` (which
// validates the URL at construction) doesn't throw on an `undefined` URL.
vi.mock('@/lib/prisma', async () => {
  const url = process.env.CARD_PAYMENT_TEST_DATABASE_URL
  if (!url) return { prisma: {} }
  const { PrismaClient } = await import('@/lib/generated/prisma')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  return { prisma }
})

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: new Proxy(
    {},
    { get: (_t, key) => `card.${String(key).toLowerCase()}` }
  ),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

import { prisma } from '@/lib/prisma'
import { POST as ImportPost } from '@/app/api/card-designs/import/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'

const COMMUNITY = 'btc-isla'
const IDS = ['veintiuno-1', 'veintiuno-2']

describe.skipIf(!runDatabaseTests)(
  'POST /api/card-designs/import is idempotent against a real Postgres PK',
  () => {
    beforeAll(async () => {
      vi.mocked(authenticateWithPermission).mockResolvedValue({
        pubkey: 'admin',
        role: Role.ADMIN,
        method: 'jwt'
      } as any)
      vi.mocked(getSettings).mockResolvedValue({
        is_community: 'true',
        community_id: COMMUNITY
      } as any)
      // Clean any leftover rows from a prior run.
      await prisma.cardDesign.deleteMany({ where: { id: { in: IDS } } })
    })

    afterAll(async () => {
      await prisma.cardDesign.deleteMany({ where: { id: { in: IDS } } })
      await prisma.$disconnect()
    })

    it('inserts on the first sync and is a no-op (200, imported: 0) on re-sync', async () => {
      const catalog = IDS.map((id, i) => ({
        id,
        communityId: COMMUNITY,
        imageUrl: `https://img.com/${i + 1}.png`,
        description: `Design ${i + 1}`
      }))
      // A fresh Response per call: the route consumes the body via res.json(),
      // and a Response body can only be read once.
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify(catalog), { status: 200 })
      )

      // First sync: nothing exists yet → both designs are inserted.
      const firstBody: any = await assertResponse(
        await ImportPost(
          createNextRequest('/api/card-designs/import', {
            method: 'POST'
          })
        ),
        200
      )
      expect(firstBody.imported).toBe(2)
      expect(firstBody.skipped).toBe(0)

      const countAfterFirst = await prisma.cardDesign.count({
        where: { id: { in: IDS } }
      })
      expect(countAfterFirst).toBe(2)

      // Second sync: the dedup findMany (now scoped to the fetched IDs) sees
      // the two rows inserted above, filters them out, and the route returns
      // the "already up to date" 200 — instead of attempting to re-insert and
      // colliding on the `id` primary key (which a real Postgres would reject
      // with Prisma P2002 → 409/500).
      const secondBody: any = await assertResponse(
        await ImportPost(
          createNextRequest('/api/card-designs/import', {
            method: 'POST'
          })
        ),
        200
      )
      expect(secondBody.imported).toBe(0)
      expect(secondBody.skipped).toBe(2)

      // No new rows were inserted on the re-sync (idempotent).
      const countAfterSecond = await prisma.cardDesign.count({
        where: { id: { in: IDS } }
      })
      expect(countAfterSecond).toBe(2)
    })
  }
)
