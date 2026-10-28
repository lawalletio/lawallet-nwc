import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPrismaClient } from '@/lib/create-prisma-client'
import type { PrismaClient } from '@/lib/generated/prisma'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupImportRequest
} from '@/lib/validation/schemas'
import type { ParsedBackup } from '@/lib/backup/archive'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

describe.skipIf(!runDatabaseTests)(
  'backup import remaps duplicate users against PostgreSQL',
  () => {
    let prisma: PrismaClient
    let applyBackup: typeof import('@/lib/backup/import').applyBackup
    const liveUserId = `backup-remap-live-${randomUUID()}`
    const backupUserId = `backup-remap-source-${randomUUID()}`
    const pubkey = randomBytes(32).toString('hex')
    const paymentHash = randomBytes(32).toString('hex')

    beforeAll(async () => {
      if (!databaseUrl) return
      prisma = createPrismaClient(databaseUrl)
      await prisma.user.create({ data: { id: liveUserId, pubkey } })
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      applyBackup = (await import('@/lib/backup/import')).applyBackup
    })

    afterAll(async () => {
      if (!prisma) return
      await prisma.user.deleteMany({
        where: { id: { in: [liveUserId, backupUserId] } }
      })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
    })

    it('imports a tag under the live account id instead of dropping it', async () => {
      const parsed: ParsedBackup = {
        manifest: {
          schemaVersion: BACKUP_SCHEMA_VERSION,
          appVersion: 'test',
          prismaMigration: null,
          exportedAt: '2026-01-01T00:00:00.000Z',
          encrypted: false,
          categories: ['core'],
          tables: {} as ParsedBackup['manifest']['tables']
        },
        tables: {
          users: [
            {
              id: backupUserId,
              pubkey,
              createdAt: '2026-01-01T00:00:00.000Z',
              role: 'USER',
              relays: null,
              relaysUpdatedAt: null
            }
          ],
          transactionLabels: [
            {
              userId: backupUserId,
              paymentHash,
              label: 'Coffee'
            }
          ]
        }
      }
      const request: BackupImportRequest = {
        mode: 'merge',
        defaultStrategy: 'skip',
        perConflict: [],
        preferBackupPrimary: false,
        atomic: true
      }

      const result = await applyBackup(parsed, request)

      expect(result.tables.users?.skipped).toBe(1)
      expect(result.tables.transactionLabels?.imported).toBe(1)
      const label = await prisma.transactionLabel.findUnique({
        where: { userId_paymentHash: { userId: liveUserId, paymentHash } }
      })
      expect(label?.label).toBe('Coffee')
    })
  }
)
