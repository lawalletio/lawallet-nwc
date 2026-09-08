import { describe, expect, it, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    isProduction: false,
    isTest: true,
    isDevelopment: false,
    logPretty: false,
    nwcVault: {
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
  type BackupTableName
} from '@/lib/validation/schemas'
import type { ParsedBackup } from '@/lib/backup/archive'
import { applyBackup } from '@/lib/backup/import'
import { emitRestoreEvents } from '@/lib/backup/events'
import { eventBus } from '@/lib/events/event-bus'

type TableResult = NonNullable<BackupImportResult['tables'][BackupTableName]>

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

/** Wires `$transaction` to run the callback (staging mutations) then reject. */
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
  // Merge loads existing rows by PK before classifying; none match the backup.
  ;(prismaMock.settings.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    []
  )
  ;(prismaMock.settings.create as ReturnType<typeof vi.fn>).mockResolvedValue(
    SETTINGS_ROW
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(eventBus.emit).mockClear()
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
      // Atomic rollback is whole-transaction, not per-table; no single `table`.
      expect(result.errors[0].table).toBeUndefined()
      expect(result.errors[0].message).toContain('Database operation failed:')

      // The callback staged `imported: 1` then Postgres rolled it all back.
      // After the fix, committed-looking counters are zeroed...
      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.overwritten).toBe(0)
      expect(result.tables.settings!.renamed).toBe(0)
      expect(result.tables.settings!.deleted).toBe(0)
      expect(result.tables.settings!.skipped).toBe(0)
      // ...and `failed` is bumped to signal "nothing committed".
      expect(result.tables.settings!.failed).toBe(1)

      // `emitRestoreEvents` derives `touched` from the staged counters; with all
      // of them zeroed, no spurious SSE refresh is broadcast for rolled-back work.
      emitRestoreEvents(result)
      expect(eventBus.emit).not.toHaveBeenCalled()
    })

    it('resets ALL in-scope tables (not just the one being processed) on rollback', async () => {
      // Two-table backup: settings + pluginRecords. The transaction stages both
      // before rejecting, so both tables carry phantom counts pre-fix.
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
      // settings was staged (imported: 1 pre-fix) — now zeroed + flagged.
      expect(result.tables.settings!.imported).toBe(0)
      expect(result.tables.settings!.deleted).toBe(0)
      expect(result.tables.settings!.failed).toBe(1)
      // pluginRecords was also staged — now zeroed + flagged too, proving the
      // reset iterates every in-scope table, not just the failing one.
      expect(result.tables.pluginRecords!.imported).toBe(0)
      expect(result.tables.pluginRecords!.deleted).toBe(0)
      expect(result.tables.pluginRecords!.failed).toBe(1)
    })

    it('preserves per-row validation failures across an atomic rollback', async () => {
      // One valid row + one invalid row (missing required `name`). The invalid
      // row is recorded as `failed` + a `notes` entry before the transaction;
      // the atomic rollback must zero the staged `imported` count but preserve
      // the invalid-row failure accounting, then add the atomic failure.
      seedSettingsReplace()
      transactionRejectsAfterCallback('Transaction already closed')

      const invalidRow = { ...SETTINGS_ROW, name: '' } // violates z.string().min(1)
      const result = await applyBackup(
        buildParsedBackup(['settings'], {
          settings: [SETTINGS_ROW, invalidRow]
        }),
        atomicReplace
      )

      // Staged work was rolled back.
      expect(result.tables.settings!.imported).toBe(0)
      // 1 invalid row + 1 atomic rollback failure.
      expect(result.tables.settings!.failed).toBe(2)
      // The invalid-row note survives (it failed validation independently).
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

      // The error must NOT have been swallowed into `result.errors`; nothing to
      // assert on the result here — the rejection is the contract. Verify the
      // 503/500 mapping in error-handler happens upstream (handled by the route).
    })

    it('reports committed counts and broadcasts SSE on a successful atomic replace', async () => {
      // Happy path: $transaction resolves (default prisma-mock pass-through),
      // so the staged counts describe real committed work and SSE fires.
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
      // The new row was staged (`imported: 1`) before the rollback; now zeroed.
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
      // Non-atomic merge runs one transaction per table and bumps `failed` only
      // for the failing table, attributing the error — the established pattern
      // the atomic fix mirrors. This guards against regressing that behavior.
      seedSettingsMerge()
      transactionRejectsAfterCallback('Transaction already closed')

      const result = await applyBackup(
        buildParsedBackup(['settings'], { settings: [SETTINGS_ROW] }),
        nonAtomicMerge
      )

      expect(result.hadErrors).toBe(true)
      expect(result.errors).toHaveLength(1)
      // Non-atomic attributes the error to the table.
      expect(result.errors[0].table).toBe('settings')
      // The staged `imported` count is NOT reset in non-atomic mode (other tables
      // may have committed); only `failed` is bumped for the failing table.
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
