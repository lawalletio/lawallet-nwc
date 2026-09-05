import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { applyBackup } from '@/lib/backup/import'
import type { ParsedBackup } from '@/lib/backup/archive'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupImportRequest,
  type BackupManifest,
  type BackupTableName
} from '@/lib/validation/schemas'

// import.ts pulls in the NWC vault (which reads getConfig().nwcVault at call
// time). Even though these tests never import an NWC wallet row, mock config
// so any transitive load is deterministic (mirrors export.test.ts).
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: {
      secret: 'test-backup-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

type Row = Record<string, unknown>

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

describe('backup import runMerge — partial-unique skip vs import', () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  describe('flag-based partial-unique (lightningAddresses isPrimary)', () => {
    it('imports the backup row demoted on `skip` (NOT a skip)', async () => {
      // user.findMany — prefetchFkTargets for the required userId FK to users.
      ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [{ id: 'u1' }]
      )
      // lightningAddress.findMany — existingByPk query has `username`; the
      // partial-unique (isPrimary) queries do not.
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
      // The row was still written, with the primary flag demoted to false so
      // the existing alice row keeps its slot.
      expect(prismaMock.lightningAddress.create).toHaveBeenCalledOnce()
      const created = (
        prismaMock.lightningAddress.create as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as { data: Row }
      expect(created.data.username).toBe('bob')
      expect(created.data.isPrimary).toBe(false)
      // No incumbent demotion on skip-prefer-existing.
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
      // Incoming bob keeps isPrimary: true; the incumbent alice is demoted.
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
      // card.findMany — prefetchFkTargets for the required cardId FK to cards.
      ;(prismaMock.card.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [{ id: 'card-1' }]
      )
      // cardActivationToken.findMany — existingByPk query has `id`; the
      // pending-status (where-flavor) queries do not.
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
      // A predicate-based partial-unique skip genuinely drops the row.
      expect(prismaMock.cardActivationToken.create).not.toHaveBeenCalled()
    })
  })

  it('matches the wizard tally invariant: flag-based skip imports, where-flavor skip skips', async () => {
    // Single plan with both rows: the flag-based la (skip→imported) and the
    // where-flavor token (skip→skipped). Asserts the server-side counts the
    // restore-wizard tally must mirror.
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
