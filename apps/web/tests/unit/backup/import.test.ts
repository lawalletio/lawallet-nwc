import { describe, expect, it, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    isProduction: false,
    isTest: true,
    isDevelopment: false,
    logPretty: false,
    nwcVault: {
      previousSecrets: [],
      secret: 'test-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

import {
  BACKUP_SCHEMA_VERSION,
  backupImportRequestSchema,
  type BackupManifest,
  type BackupImportResult,
  type BackupImportRequest,
  type BackupTableName
} from '@/lib/validation/schemas'
import type { ParsedBackup } from '@/lib/backup/archive'
import { applyBackup } from '@/lib/backup/import'
import { emitRestoreEvents } from '@/lib/backup/events'
import { eventBus } from '@/lib/events/event-bus'

type TableResult = NonNullable<BackupImportResult['tables'][BackupTableName]>
type Row = Record<string, unknown>

const SETTINGS_ROW = {
  name: 'domain',
  value: 'example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const PLUGIN_RECORD_ROW = {
  id: 'rec-1',
  pluginId: 'plugin',
  kind: 'K',
  key: 'k1',
  data: { enabled: true },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const atomicReplace = backupImportRequestSchema.parse({
  mode: 'replace',
  atomic: true
})
const atomicMerge = backupImportRequestSchema.parse({
  mode: 'merge',
  atomic: true
})
const nonAtomicMerge = backupImportRequestSchema.parse({
  mode: 'merge',
  atomic: false
})

function buildParsedBackup(
  categories: BackupManifest['categories'],
  tables: ParsedBackup['tables']
): ParsedBackup {
  const tableMeta = {} as BackupManifest['tables']
  for (const [table, rows] of Object.entries(tables)) {
    tableMeta[table as keyof BackupManifest['tables']] = {
      count: rows!.length,
      sha256: 'unused'
    }
  }
  return {
    manifest: {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.0-test',
      prismaMigration: null,
      exportedAt: '2026-01-01T00:00:00.000Z',
      encrypted: false,
      categories,
      tables: tableMeta
    },
    tables
  }
}

function transactionRejectsAfterCallback(errorMessage: string) {
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: any) => {
      await fn(prismaMock)
      throw new Error(errorMessage)
    }
  )
}

function seedSettingsReplace() {
  ;(
    prismaMock.settings.deleteMany as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    count: 0
  })
  ;(prismaMock.settings.create as ReturnType<typeof vi.fn>).mockResolvedValue(
    SETTINGS_ROW
  )
}

function seedSettingsMerge() {
  ;(prismaMock.settings.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    []
  )
  ;(prismaMock.settings.create as ReturnType<typeof vi.fn>).mockResolvedValue(
    SETTINGS_ROW
  )
}

function makeManifest(categories: BackupTableName[]): BackupManifest {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: 'test',
    prismaMigration: null,
    exportedAt: '2026-01-01T00:00:00.000Z',
    encrypted: false,
    categories: ['core'],
    tables: {} as BackupManifest['tables']
  }
}

function makeParsed(table: BackupTableName, rows: Row[]): ParsedBackup {
  return {
    manifest: makeManifest([table]),
    tables: { [table]: rows }
  }
}

function resolution(
  perConflict: { id: string; strategy: 'skip' | 'overwrite' | 'rename' }[],
  overrides: Partial<BackupImportRequest> = {}
): BackupImportRequest {
  return {
    mode: 'merge',
    defaultStrategy: 'skip',
    perConflict,
    preferBackupPrimary: false,
    atomic: true,
    ...overrides
  }
}

const LA_BC_BOB: Row = {
  username: 'bob',
  userId: 'u1',
  mode: 'IDLE',
  redirect: null,
  remoteWalletId: null,
  isPrimary: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const LA_LIVE_ALICE: Row = {
  username: 'alice',
  userId: 'u1',
  isPrimary: true
}

const TOKEN_BC_NEW: Row = {
  id: 'tok-2',
  cardId: 'card-1',
  qrKind: 'ONE_TIME',
  status: 'PENDING',
  qrPayload: 'p',
  issuedByUserId: null,
  expiresAt: null,
  claimedAt: null,
  claimedByUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z'
}
const TOKEN_LIVE_EXISTING: Row = {
  id: 'tok-1',
  cardId: 'card-1',
  qrKind: 'ONE_TIME',
  status: 'PENDING'
}

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(eventBus.emit).mockClear()
})

describe('backup import runMerge — partial-unique skip vs import', () => {
  describe('flag-based partial-unique (lightningAddresses isPrimary)', () => {
    it('imports the backup row demoted on `skip` (NOT a skip)', async () => {
      ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [{ id: 'u1' }]
      )
      ;(
        prismaMock.lightningAddress.findMany as ReturnType<typeof vi.fn>
      ).mockImplementation((args: { where?: Record<string, unknown> }) => {
        const where = args?.where
        if (where && 'username' in where) return Promise.resolve([])
        return Promise.resolve([LA_LIVE_ALICE])
      })
      ;(
        prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(LA_BC_BOB)

      const parsed = makeParsed('lightningAddresses', [LA_BC_BOB])
      const result = await applyBackup(
        parsed,
        resolution([{ id: 'lightningAddresses:bob', strategy: 'skip' }])
      )

      const t = result.tables.lightningAddresses!
      expect(t.imported).toBe(1)
      expect(t.skipped).toBe(0)
      expect(prismaMock.lightningAddress.create).toHaveBeenCalledOnce()
      const created = (
        prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as { data: Row }
      expect(created.data.username).toBe('bob')
      expect(created.data.isPrimary).toBe(false)
      expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
    })

    it('imports on `overwrite` and demotes the incumbent (prefer=true)', async () => {
      ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [{ id: 'u1' }]
      )
      ;(
        prismaMock.lightningAddress.findMany as ReturnType<typeof vi.fn>
      ).mockImplementation((args: { where?: Record<string, unknown> }) => {
        const where = args?.where
        if (where && 'username' in where) return Promise.resolve([])
        return Promise.resolve([LA_LIVE_ALICE])
      })
      ;(
        prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(LA_BC_BOB)
      ;(
        prismaMock.lightningAddress.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue(LA_LIVE_ALICE)

      const parsed = makeParsed('lightningAddresses', [LA_BC_BOB])
      const result = await applyBackup(
        parsed,
        resolution([{ id: 'lightningAddresses:bob', strategy: 'overwrite' }])
      )

      const t = result.tables.lightningAddresses!
      expect(t.imported).toBe(1)
      expect(t.skipped).toBe(0)
      const created = (
        prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as { data: Row }
      expect(created.data.isPrimary).toBe(true)
      expect(prismaMock.lightningAddress.update).toHaveBeenCalledOnce()
      const updated = (
        prismaMock.lightningAddress.update as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as { where: Row; data: Row }
      expect(updated.where).toEqual({ username: 'alice' })
      expect(updated.data).toEqual({ isPrimary: false })
    })
  })

  describe('where-flavor partial-unique (cardActivationTokens pending)', () => {
    it('genuinely skips on `skip` (no row written)', async () => {
      ;(prismaMock.card.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [{ id: 'card-1' }]
      )
      ;(
        prismaMock.cardActivationToken.findMany as ReturnType<typeof vi.fn>
      ).mockImplementation((args: { where?: Record<string, unknown> }) => {
        const where = args?.where
        if (where && 'id' in where) return Promise.resolve([])
        return Promise.resolve([TOKEN_LIVE_EXISTING])
      })
      ;(
        prismaMock.cardActivationToken.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(TOKEN_BC_NEW)

      const parsed = makeParsed('cardActivationTokens', [TOKEN_BC_NEW])
      const result = await applyBackup(
        parsed,
        resolution([{ id: 'cardActivationTokens:tok-2', strategy: 'skip' }])
      )

      const t = result.tables.cardActivationTokens!
      expect(t.skipped).toBe(1)
      expect(t.imported).toBe(0)
      expect(prismaMock.cardActivationToken.create).not.toHaveBeenCalled()
    })
  })

  it('matches the wizard tally invariant: flag-based skip imports, where-flavor skip skips', async () => {
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'u1' }
    ])
    ;(prismaMock.card.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'card-1' }
    ])
    ;(
      prismaMock.lightningAddress.findMany as ReturnType<typeof vi.fn>
    ).mockImplementation((args: { where?: Record<string, unknown> }) => {
      const where = args?.where
      if (where && 'username' in where) return Promise.resolve([])
      return Promise.resolve([LA_LIVE_ALICE])
    })
    ;(
      prismaMock.cardActivationToken.findMany as ReturnType<typeof vi.fn>
    ).mockImplementation((args: { where?: Record<string, unknown> }) => {
      const where = args?.where
      if (where && 'id' in where) return Promise.resolve([])
      return Promise.resolve([TOKEN_LIVE_EXISTING])
    })
    ;(
      prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
    ).mockResolvedValue(LA_BC_BOB)
    ;(
      prismaMock.cardActivationToken.create as ReturnType<typeof vi.fn>
    ).mockResolvedValue(TOKEN_BC_NEW)

    const parsed: ParsedBackup = {
      manifest: makeManifest(['lightningAddresses', 'cardActivationTokens']),
      tables: {
        lightningAddresses: [LA_BC_BOB],
        cardActivationTokens: [TOKEN_BC_NEW]
      }
    }
    const result = await applyBackup(
      parsed,
      resolution([
        { id: 'lightningAddresses:bob', strategy: 'skip' },
        { id: 'cardActivationTokens:tok-2', strategy: 'skip' }
      ])
    )

    expect(result.tables.lightningAddresses!.imported).toBe(1)
    expect(result.tables.lightningAddresses!.skipped).toBe(0)
    expect(result.tables.cardActivationTokens!.imported).toBe(0)
    expect(result.tables.cardActivationTokens!.skipped).toBe(1)
  })
})

describe('applyBackup — atomic transaction rollback counters', () => {
  describe('replace mode (atomic)', () => {
    it('resets staged-but-uncommitted counts when $transaction rejects after the callback runs (timeout)', async () => {
      seedSettingsReplace()
      transactionRejectsAfterCallback('Transaction already closed')

      const result = await applyBackup(
        buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
        atomicReplace
      )

      expect(result.hadErrors).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].table).toBeUndefined()
      expect(result.errors[0].message).toContain('Database operation failed:')

      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.overwritten).toBe(0)
      expect(result.tables.settings!.renamed).toBe(0)
      expect(result.tables.settings!.deleted).toBe(0)
      expect(result.tables.settings!.skipped).toBe(0)
      expect(result.tables.settings!.failed).toBe(1)

      emitRestoreEvents(result)
      expect(eventBus.emit).not.toHaveBeenCalled()
    })

    it('resets ALL in-scope tables (not just the one being processed) on rollback', async () => {
      ;(
        prismaMock.settings.deleteMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ count: 0 })
      ;(
        prismaMock.pluginRecord.deleteMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ count: 0 })
      ;(
        prismaMock.settings.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(SETTINGS_ROW)
      ;(
        prismaMock.pluginRecord.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue(PLUGIN_RECORD_ROW)
      transactionRejectsAfterCallback('Transaction already closed')

      const result = await applyBackup(
        buildParsedBackup(['settings', 'plugins'], {
          settings: [SETTINGS_ROW],
          pluginRecords: [PLUGIN_RECORD_ROW]
        }),
        atomicReplace
      )

      expect(result.errors).toHaveLength(1)
      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.deleted).toBe(0)
      expect(result.tables.settings!.failed).toBe(1)
      expect(result.tables.pluginRecords!.imported).toBe(0)
      expect(result.tables.pluginRecords!.deleted).toBe(0)
      expect(result.tables.pluginRecords!.failed).toBe(1)
    })

    it('preserves per-row validation failures across an atomic rollback', async () => {
      seedSettingsReplace()
      transactionRejectsAfterCallback('Transaction already closed')

      const invalidRow = { ...SETTINGS_ROW, name: '' }
      const result = await applyBackup(
        buildParsedBackup(['settings'], {
          settings: [SETTINGS_ROW, invalidRow]
        }),
        atomicReplace
      )

      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.failed).toBe(2)
      expect(result.tables.settings!.notes).toEqual([
        { id: 'row-1', reason: 'invalid-row' }
      ])
      expect(result.hadErrors).toBe(true)
    })

    it('re-throws non-timeout/non-connection errors instead of swallowing them', async () => {
      seedSettingsReplace()
      transactionRejectsAfterCallback('Some other Prisma error')

      await expect(
        applyBackup(
          buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
          atomicReplace
        )
      ).rejects.toThrow('Some other Prisma error')
    })

    it('reports committed counts and broadcasts SSE on a successful atomic replace', async () => {
      seedSettingsReplace()

      const result = await applyBackup(
        buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
        atomicReplace
      )

      expect(result.hadErrors).toBe(false)
      expect(result.errors).toHaveLength(0)
      expect(result.tables.settings!.imported).toBe(1)
      expect(result.tables.settings!.failed).toBe(0)

      emitRestoreEvents(result)
      expect(eventBus.emit).toHaveBeenCalledTimes(1)
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'settings:updated' })
      )
    })
  })

  describe('merge mode (atomic)', () => {
    it('resets staged counts when the atomic merge transaction rejects after the callback runs', async () => {
      seedSettingsMerge()
      transactionRejectsAfterCallback('Transaction already closed')

      const result = await applyBackup(
        buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
        atomicMerge
      )

      expect(result.hadErrors).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('Database operation failed:')
      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.skipped).toBe(0)
      expect(result.tables.settings!.overwritten).toBe(0)
      expect(result.tables.settings!.renamed).toBe(0)
      expect(result.tables.settings!.failed).toBe(1)

      emitRestoreEvents(result)
      expect(eventBus.emit).not.toHaveBeenCalled()
    })
  })

  describe('merge mode (non-atomic) — unchanged path regression guard', () => {
    it('records per-table failure and attributes the error when a single per-table transaction fails', async () => {
      seedSettingsMerge()
      transactionRejectsAfterCallback('Transaction already closed')

      const result = await applyBackup(
        buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
        nonAtomicMerge
      )

      expect(result.hadErrors).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].table).toBe('settings')
      expect(result.tables.settings!.failed).toBe(1)
    })
  })
})

describe('emitRestoreEvents — rollback-aware SSE gating', () => {
  function tableResult(over: Partial<TableResult> = {}): TableResult {
    return {
      imported: 0,
      skipped: 0,
      overwritten: 0,
      renamed: 0,
      deleted: 0,
      failed: 0,
      notes: [],
      ...over
    }
  }

  it('does not emit for tables whose only non-zero counter is `failed` (rolled-back shape)', async () => {
    const result: BackupImportResult = {
      mode: 'replace',
      tables: {
        settings: tableResult({ failed: 1 }),
        users: tableResult({ failed: 1 })
      },
      hadErrors: true,
      errors: [{ message: 'Database operation failed: …' }],
      importedAt: '2026-01-01T00:00:00.000Z'
    }

    emitRestoreEvents(result)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })
})
