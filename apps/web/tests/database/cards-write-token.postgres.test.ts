import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@/lib/generated/prisma'
import { createPrismaClient } from '@/lib/create-prisma-client'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

describe.skipIf(!runDatabaseTests)(
  'atomic write-token consume against PostgreSQL',
  () => {
    let prisma: PrismaClient
    let GET: (
      req: NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ) => Promise<Response>
    const suffix = randomUUID()
    const designId = `write-token-design-${suffix}`
    const cardId = `write-token-card-${suffix}`
    const ntag424Cid = randomUUID().replaceAll('-', '').slice(0, 14)
    const token = randomUUID().replaceAll('-', '')

    beforeAll(async () => {
      if (!databaseUrl || !runDatabaseTests) return
      prisma = createPrismaClient(databaseUrl)
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      // Public URL + settings stubs: the route calls resolveApiUrl(req) and
      // (transitively) getSettings. Stub them so the handler runs end-to-end
      // without the full config/settings stack.
      vi.doMock('@/lib/public-url', () => ({
        resolveApiUrl: vi.fn(async () => 'https://write-test.local'),
        resolvePublicEndpoint: vi.fn(async () => ({
          host: 'write-test.local',
          url: 'https://write-test.local'
        })),
        resolveAddressDomain: vi.fn(async () => 'write-test.local')
      }))
      vi.doMock('@/lib/settings', () => ({
        getSettings: vi.fn(async () => ({ domain: '', endpoint: '' }))
      }))
      ;({ GET } = await import('@/app/api/cards/[id]/write/route'))

      await prisma.cardDesign.create({
        data: {
          id: designId,
          imageUrl: 'https://example.test/card.png',
          description: 'Write-token concurrency test'
        }
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
        data: {
          id: cardId,
          designId,
          ntag424Cid,
          writeToken: token,
          writeTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
      })
    })

    afterAll(async () => {
      if (!databaseUrl || !runDatabaseTests || !prisma) return
      await prisma.card.deleteMany({ where: { id: cardId } })
      await prisma.ntag424.deleteMany({ where: { cid: ntag424Cid } })
      await prisma.cardDesign.deleteMany({ where: { id: designId } })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
      vi.doUnmock('@/lib/public-url')
      vi.doUnmock('@/lib/settings')
    })

    function writeRequest() {
      const url = new URL(
        `/api/cards/${cardId}/write?token=${token}`,
        'http://write-test.local'
      )
      return new NextRequest(url, {
        method: 'GET',
        headers: new Headers({ host: 'write-test.local' })
      })
    }

    it('single-flights two simultaneous /write requests with the same token', async () => {
      const [first, second] = await Promise.all([
        GET(writeRequest(), {
          params: Promise.resolve({ id: cardId })
        }),
        GET(writeRequest(), {
          params: Promise.resolve({ id: cardId })
        })
      ])

      const statuses = [first.status, second.status].sort()
      // Exactly ONE request wins (200) and the other is rejected (403). The bug
      // would surface as [200, 200]; a regression to [403, 403] would mean the
      // consume predicate is too strict.
      expect(statuses).toEqual([200, 403])

      const winner = first.status === 200 ? first : second
      const loser = first.status === 200 ? second : first
      const winnerBody = await winner.json()
      expect(winnerBody.k0).toBeDefined()
      expect(winnerBody.protocol_name).toBe('new_bolt_card_response')
      const loserBody = await loser.json().catch(() => ({}))
      expect(loserBody.k0).toBeUndefined()

      // The token is consumed exactly once and the card is unpaired but still
      // fresh (lastUsedAt stays null — exporting keys != tapping).
      const card = await prisma.card.findUniqueOrThrow({
        where: { id: cardId }
      })
      expect(card.writeToken).toBeNull()
      expect(card.userId).toBeNull()
      expect(card.lastUsedAt).toBeNull()
      expect(card.blockedAt).toBeNull()
    })

    it('a third request after both completions is 403 (token already consumed)', async () => {
      const res = await GET(writeRequest(), {
        params: Promise.resolve({ id: cardId })
      })
      expect(res.status).toBe(403)
    })
  }
)
