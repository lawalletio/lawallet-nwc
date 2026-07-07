import { zipSync } from 'fflate'
import { prisma } from '@/lib/prisma'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupCategory,
  type BackupExportRequest,
  type BackupManifest,
  type BackupTableName,
} from '@/lib/validation/schemas'
import { TABLE_DESCRIPTORS, resolveTables } from '@/lib/backup/tables'
import { BACKUP_README, sha256, toNdjson, utf8Encode } from '@/lib/backup/serialize'
import { encryptArchive } from '@/lib/backup/crypto'
import packageJson from '../../package.json'

type ExportOptions = BackupExportRequest['options']

interface GatheredTable {
  rows: unknown[]
  truncated: boolean
}

/** Reads every row of a table (full, un-redacted — secrets included). */
async function gatherTable(table: BackupTableName, options: ExportOptions): Promise<GatheredTable> {
  // Large, append-only table: bound by recency + a hard cap so a huge history
  // can't blow memory or the response size. `take: limit + 1` detects overflow.
  if (table === 'activityLogs') {
    const where = options.activityLogSince
      ? { createdAt: { gte: new Date(options.activityLogSince) } }
      : undefined
    const rows = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.activityLogLimit + 1,
    })
    const truncated = rows.length > options.activityLogLimit
    return { rows: truncated ? rows.slice(0, options.activityLogLimit) : rows, truncated }
  }

  const delegate = prisma[TABLE_DESCRIPTORS[table].model as keyof typeof prisma] as {
    findMany: (args?: unknown) => Promise<unknown[]>
  }
  const rows = await delegate.findMany()
  return { rows, truncated: false }
}

/** Best-effort latest applied Prisma migration id, for the manifest. */
export async function latestMigration(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `
    return rows[0]?.migration_name ?? null
  } catch {
    return null
  }
}

export interface BuiltBackup {
  buffer: Buffer
  manifest: BackupManifest
  filename: string
}

/**
 * Gathers the selected categories, serializes each table to NDJSON, zips it all
 * with a manifest + README, and (when a password is given) wraps the archive in
 * an AES-256-GCM envelope. Returns the buffer plus the download filename.
 */
export async function buildBackup(
  categories: BackupCategory[],
  options: ExportOptions,
  password?: string,
): Promise<BuiltBackup> {
  const tables = resolveTables(categories)
  const files: Record<string, Uint8Array> = {}
  const tableMeta: BackupManifest['tables'] = {}

  for (const table of tables) {
    const { rows, truncated } = await gatherTable(table, options)
    const bytes = utf8Encode(toNdjson(rows))
    files[`tables/${table}.ndjson`] = bytes
    tableMeta[table] = {
      count: rows.length,
      sha256: sha256(bytes),
      ...(truncated ? { truncated: true } : {}),
    }
  }

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: packageJson.version,
    prismaMigration: await latestMigration(),
    exportedAt: new Date().toISOString(),
    encrypted: Boolean(password),
    categories,
    tables: tableMeta,
  }

  files['manifest.json'] = utf8Encode(JSON.stringify(manifest, null, 2))
  files['README.txt'] = utf8Encode(BACKUP_README)

  const zipped = zipSync(files, { level: 6 })
  let buffer: Buffer = Buffer.from(zipped)
  if (password) buffer = encryptArchive(buffer, password)

  const stamp = manifest.exportedAt.replace(/[:.]/g, '-')
  const filename = `lawallet-backup-${stamp}.zip${password ? '.enc' : ''}`

  return { buffer, manifest, filename }
}
