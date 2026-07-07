import { describe, it, expect, beforeEach, vi } from 'vitest'
import { zipSync } from 'fflate'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { buildBackup } from '@/lib/backup/export'
import {
  parseBackupFile,
  BACKUP_PASSWORD_REQUIRED,
  BACKUP_PASSWORD_INVALID,
} from '@/lib/backup/archive'
import { encryptArchive } from '@/lib/backup/crypto'
import { sha256, toNdjson, utf8Encode } from '@/lib/backup/serialize'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupManifest,
} from '@/lib/validation/schemas'

const USER = {
  id: 'user-1',
  pubkey: 'a'.repeat(64),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  albyEnabled: false,
  role: 'ADMIN',
  relays: null,
  relaysUpdatedAt: null,
}

const options = { activityLogLimit: 100_000 }

/** buildBackup only reads the settings delegate for the `settings` category. */
function seedSettingsOnly(rows: unknown[] = []) {
  ;(prismaMock.settings.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows)
}

/**
 * Hand-builds a zip archive from a set of table row-arrays, computing a correct
 * manifest (per-table count + sha256). Extra overrides let a test tamper with it.
 */
function buildZip(
  tableRows: Record<string, unknown[]>,
  manifestOverride: Partial<BackupManifest> = {},
  tamper?: (files: Record<string, Uint8Array>) => void,
): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const tableMeta: BackupManifest['tables'] = {}
  for (const [table, rows] of Object.entries(tableRows)) {
    const bytes = utf8Encode(toNdjson(rows))
    files[`tables/${table}.ndjson`] = bytes
    tableMeta[table as keyof BackupManifest['tables']] = {
      count: rows.length,
      sha256: sha256(bytes),
    }
  }
  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.0-test',
    prismaMigration: null,
    exportedAt: '2026-07-06T12:00:00.000Z',
    encrypted: false,
    categories: ['settings'],
    tables: tableMeta,
    ...manifestOverride,
  }
  files['manifest.json'] = utf8Encode(JSON.stringify(manifest, null, 2))
  if (tamper) tamper(files)
  return zipSync(files, { level: 6 })
}

function toFile(bytes: Uint8Array, name = 'backup.zip'): File {
  return new File([new Uint8Array(bytes)], name)
}

beforeEach(() => {
  resetPrismaMock()
  seedSettingsOnly()
})

describe('backup archive (parseBackupFile)', () => {
  it('returns the manifest + parsed rows for a valid archive', async () => {
    ;(prismaMock.settings.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'domain', value: 'example.com', createdAt: USER.createdAt, updatedAt: USER.createdAt },
    ])
    const { buffer } = await buildBackup(['settings'], options, undefined)
    const parsed = await parseBackupFile(toFile(buffer))
    expect(parsed.manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(parsed.tables.settings).toHaveLength(1)
    expect((parsed.tables.settings as Record<string, unknown>[])[0].name).toBe('domain')
  })

  it('parses a hand-built archive with a correct manifest', async () => {
    const bytes = buildZip({
      settings: [
        {
          name: 'domain',
          value: 'x.test',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const parsed = await parseBackupFile(toFile(bytes))
    expect(parsed.tables.settings).toHaveLength(1)
  })

  it('throws when a table checksum is tampered', async () => {
    const bytes = buildZip({ settings: [{ name: 'a', value: 'b' }] }, {}, files => {
      // Corrupt the table bytes so its sha256 no longer matches the manifest.
      files['tables/settings.ndjson'] = utf8Encode('{"name":"a","value":"TAMPERED"}')
    })
    await expect(parseBackupFile(toFile(bytes))).rejects.toThrow(/Integrity check failed/)
  })

  it('throws when the row count mismatches the manifest', async () => {
    // Manifest claims count 5 but the file has one row.
    const rows = [{ name: 'a', value: 'b' }]
    const good = buildZip({ settings: rows })
    // Rebuild with a doctored manifest count while keeping the real sha256.
    const settingsBytes = utf8Encode(toNdjson(rows))
    const manifest: BackupManifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.0-test',
      prismaMigration: null,
      exportedAt: '2026-07-06T12:00:00.000Z',
      encrypted: false,
      categories: ['settings'],
      tables: { settings: { count: 5, sha256: sha256(settingsBytes) } },
    }
    const bytes = zipSync({
      'tables/settings.ndjson': settingsBytes,
      'manifest.json': utf8Encode(JSON.stringify(manifest, null, 2)),
    })
    void good
    await expect(parseBackupFile(toFile(bytes))).rejects.toThrow(/Row count mismatch/)
  })

  it('throws a password-required error for an encrypted archive with no password', async () => {
    const inner = buildZip({ settings: [{ name: 'a', value: 'b' }] })
    const encrypted = encryptArchive(inner, 'sekret')
    await expect(parseBackupFile(toFile(encrypted, 'backup.zip.enc'))).rejects.toMatchObject({
      code: BACKUP_PASSWORD_REQUIRED,
    })
  })

  it('throws a password-invalid error for an encrypted archive with the wrong password', async () => {
    const inner = buildZip({ settings: [{ name: 'a', value: 'b' }] })
    const encrypted = encryptArchive(inner, 'sekret')
    await expect(
      parseBackupFile(toFile(encrypted, 'backup.zip.enc'), 'wrong'),
    ).rejects.toMatchObject({ code: BACKUP_PASSWORD_INVALID })
  })

  it('throws when schemaVersion is greater than BACKUP_SCHEMA_VERSION', async () => {
    const bytes = buildZip(
      { settings: [{ name: 'a', value: 'b' }] },
      { schemaVersion: BACKUP_SCHEMA_VERSION + 1 },
    )
    await expect(parseBackupFile(toFile(bytes))).rejects.toThrow(/newer version/)
  })

  it('throws when the manifest is missing entirely', async () => {
    const bytes = zipSync({ 'tables/settings.ndjson': utf8Encode('{}') })
    await expect(parseBackupFile(toFile(bytes))).rejects.toThrow(/missing its manifest/)
  })

  it('throws when a manifest-listed table file is absent', async () => {
    const settingsBytes = utf8Encode(toNdjson([{ name: 'a', value: 'b' }]))
    const manifest: BackupManifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.0-test',
      prismaMigration: null,
      exportedAt: '2026-07-06T12:00:00.000Z',
      encrypted: false,
      categories: ['settings'],
      tables: { settings: { count: 1, sha256: sha256(settingsBytes) } },
    }
    // Manifest references tables/settings.ndjson but we omit the file.
    const bytes = zipSync({ 'manifest.json': utf8Encode(JSON.stringify(manifest)) })
    await expect(parseBackupFile(toFile(bytes))).rejects.toThrow(/missing data for/)
  })

  it('throws when the bytes are not a valid zip at all', async () => {
    await expect(parseBackupFile(toFile(utf8Encode('not a zip'), 'x.zip'))).rejects.toThrow(
      /not a valid backup archive/,
    )
  })
})
