import { unzipSync } from 'fflate'
import {
  BACKUP_SCHEMA_VERSION,
  backupManifestSchema,
  type BackupManifest,
  type BackupTableName,
} from '@/lib/validation/schemas'
import { ApiError, ValidationError } from '@/types/server/errors'
import { decryptArchive, isEncryptedArchive } from '@/lib/backup/crypto'
import { fromNdjson, sha256, utf8Decode } from '@/lib/backup/serialize'

/** Distinct error codes so the wizard can prompt for a password. */
export const BACKUP_PASSWORD_REQUIRED = 'BACKUP_PASSWORD_REQUIRED'
export const BACKUP_PASSWORD_INVALID = 'BACKUP_PASSWORD_INVALID'

export interface ParsedBackup {
  manifest: BackupManifest
  /** Raw parsed rows per table (pre row-schema validation). */
  tables: Partial<Record<BackupTableName, unknown[]>>
}

function passwordError(code: string, message: string): ApiError {
  return new ApiError(message, { statusCode: 400, code })
}

/**
 * Decrypts (if needed), unzips, and validates a backup archive WITHOUT touching
 * the database: checks the manifest shape, the schema version, and every
 * table's checksum + row count. Throws typed errors the routes surface as-is.
 */
export async function parseBackupFile(file: File, password?: string): Promise<ParsedBackup> {
  const raw = new Uint8Array(await file.arrayBuffer())

  let zipBytes: Uint8Array = raw
  if (isEncryptedArchive(raw)) {
    if (!password) {
      throw passwordError(BACKUP_PASSWORD_REQUIRED, 'This backup is password-protected.')
    }
    try {
      zipBytes = decryptArchive(raw, password)
    } catch {
      throw passwordError(BACKUP_PASSWORD_INVALID, 'Incorrect backup password.')
    }
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes)
  } catch {
    throw new ValidationError('This file is not a valid backup archive.')
  }

  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) {
    throw new ValidationError('Backup archive is missing its manifest.')
  }

  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(utf8Decode(manifestBytes))
  } catch {
    throw new ValidationError('Backup manifest is corrupt.')
  }

  const parsedManifest = backupManifestSchema.safeParse(manifestJson)
  if (!parsedManifest.success) {
    throw new ValidationError('Backup manifest is invalid.', parsedManifest.error.errors)
  }
  const manifest = parsedManifest.data

  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new ValidationError(
      `This backup was created by a newer version (format v${manifest.schemaVersion}). Update before restoring.`,
    )
  }

  const tables: Partial<Record<BackupTableName, unknown[]>> = {}
  for (const [table, meta] of Object.entries(manifest.tables) as [
    BackupTableName,
    { count: number; sha256: string },
  ][]) {
    const bytes = entries[`tables/${table}.ndjson`]
    if (!bytes) {
      throw new ValidationError(`Backup is missing data for "${table}".`)
    }
    if (sha256(bytes) !== meta.sha256) {
      throw new ValidationError(`Integrity check failed for "${table}" — the archive is corrupt.`)
    }
    const rows = fromNdjson(utf8Decode(bytes))
    if (rows.length !== meta.count) {
      throw new ValidationError(
        `Row count mismatch for "${table}" (expected ${meta.count}, found ${rows.length}).`,
      )
    }
    tables[table] = rows
  }

  return { manifest, tables }
}
