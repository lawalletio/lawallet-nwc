import { prisma } from '@/lib/prisma'
import {
  type BackupAnalyzeResponse,
  type BackupConflict,
  type BackupManifest,
  type BackupTableName,
} from '@/lib/validation/schemas'
import { TABLE_DESCRIPTORS, resolveTables, pkKey } from '@/lib/backup/tables'
import { ROW_SCHEMAS } from '@/lib/backup/row-schemas'
import {
  type DbClient,
  classifyRow,
  loadTableContext,
  makeConflict,
  tableNoun,
} from '@/lib/backup/classify'
import { latestMigration } from '@/lib/backup/export'
import type { ParsedBackup } from '@/lib/backup/archive'
import packageJson from '../../package.json'

type Row = Record<string, unknown>
interface TableCounts {
  total: number
  new: number
  identical: number
  conflicting: number
  invalid: number
}
interface TableAnalysis {
  counts: TableCounts
  conflicts: BackupConflict[]
}

/** Best-effort PK string for an invalid (unparseable) row, for a stable id. */
function bestEffortKey(pkFields: string[], raw: unknown, index: number): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Row
    const parts = pkFields.map(f => (obj[f] == null ? '' : String(obj[f])))
    if (parts.some(p => p !== '')) return parts.join('')
  }
  return `row-${index}`
}

/**
 * Read-only pass over a parsed archive: validates every row against its schema,
 * classifies it against the live DB (new / identical / conflicting / invalid),
 * and surfaces the conflicts the restore wizard resolves. Never writes.
 */
export async function analyzeBackup(parsed: ParsedBackup): Promise<BackupAnalyzeResponse> {
  const { manifest } = parsed
  const tablesInScope = resolveTables(manifest.categories).filter(t => parsed.tables[t])

  // 1. Schema-validate rows; split valid from invalid.
  const validByTable: Partial<Record<BackupTableName, Row[]>> = {}
  const invalidByTable: Partial<Record<BackupTableName, BackupConflict[]>> = {}
  for (const table of tablesInScope) {
    const desc = TABLE_DESCRIPTORS[table]
    const schema = ROW_SCHEMAS[table]
    const valid: Row[] = []
    const invalid: BackupConflict[] = []
    const raws = parsed.tables[table] ?? []
    raws.forEach((raw, index) => {
      const result = schema.safeParse(raw)
      if (result.success) {
        valid.push(result.data)
      } else {
        const rowKey = bestEffortKey(desc.pk, raw, index)
        invalid.push(
          makeConflict(desc, rowKey, {
            kind: 'invalid-row',
            message: `Row ${index + 1} in ${tableNoun(table)} data is invalid and can't be restored.`,
            allowedStrategies: ['skip'],
            suggestedStrategy: 'skip',
          }),
        )
      }
    })
    validByTable[table] = valid
    invalidByTable[table] = invalid
  }

  // 2. Backup PKs per table + DB presence of required FK targets not in the backup.
  const backupPks: Partial<Record<BackupTableName, Set<string>>> = {}
  for (const table of tablesInScope) {
    const desc = TABLE_DESCRIPTORS[table]
    backupPks[table] = new Set((validByTable[table] ?? []).map(r => pkKey(desc, r)))
  }
  const dbParentPks = await buildParentAvailability(
    prisma as unknown as DbClient,
    tablesInScope,
    validByTable,
    backupPks,
  )
  const isParentAvailable = (target: BackupTableName, value: unknown): boolean => {
    const key = String(value)
    return Boolean(backupPks[target]?.has(key)) || Boolean(dbParentPks[target]?.has(key))
  }

  // 3. Classify each table.
  const tablesOut: Partial<Record<BackupTableName, TableAnalysis>> = {}
  for (const table of tablesInScope) {
    const desc = TABLE_DESCRIPTORS[table]
    const rows = validByTable[table] ?? []
    const ctx = await loadTableContext(prisma as unknown as DbClient, desc, rows)
    const invalid = invalidByTable[table] ?? []
    const counts = {
      total: (parsed.tables[table] ?? []).length,
      new: 0,
      identical: 0,
      conflicting: 0,
      invalid: invalid.length,
    }
    const conflicts: BackupConflict[] = [...invalid]
    for (const row of rows) {
      const { status, conflict } = classifyRow(desc, row, ctx, isParentAvailable)
      counts[status]++
      if (conflict) conflicts.push(conflict)
    }
    tablesOut[table] = { counts, conflicts }
  }

  const warnings = await collectWarnings(manifest)

  return {
    manifest,
    tables: tablesOut as BackupAnalyzeResponse['tables'],
    warnings,
    analyzedAt: new Date().toISOString(),
  }
}

/**
 * For every required FK target value NOT present in the backup, checks whether
 * it already exists in the DB — so a child pointing at a pre-existing parent is
 * not mistaken for an orphan. Bounded: one query per referenced parent table.
 */
async function buildParentAvailability(
  db: DbClient,
  tables: BackupTableName[],
  validByTable: Partial<Record<BackupTableName, Row[]>>,
  backupPks: Partial<Record<BackupTableName, Set<string>>>,
): Promise<Partial<Record<BackupTableName, Set<string>>>> {
  const needed: Partial<Record<BackupTableName, Set<unknown>>> = {}
  for (const table of tables) {
    const desc = TABLE_DESCRIPTORS[table]
    for (const fk of desc.fks) {
      if (!fk.required) continue
      for (const row of validByTable[table] ?? []) {
        const value = row[fk.field]
        if (value == null) continue
        if (backupPks[fk.target]?.has(String(value))) continue
        ;(needed[fk.target] ??= new Set()).add(value)
      }
    }
  }

  const out: Partial<Record<BackupTableName, Set<string>>> = {}
  for (const target of Object.keys(needed) as BackupTableName[]) {
    const desc = TABLE_DESCRIPTORS[target]
    const field = desc.pk[0]
    const values = [...(needed[target] ?? [])]
    const existing = (await db[desc.model].findMany({
      where: { [field]: { in: values } },
      select: { [field]: true },
    })) as Row[]
    out[target] = new Set(existing.map(e => String(e[field])))
  }
  return out
}

/** Non-blocking advisories shown above the review step. */
async function collectWarnings(manifest: BackupManifest): Promise<string[]> {
  const warnings: string[] = []

  for (const [table, meta] of Object.entries(manifest.tables)) {
    if (meta?.truncated) {
      warnings.push(
        `The ${tableNoun(table as BackupTableName)} data was truncated at export time — this backup is not a complete copy of that table.`,
      )
    }
  }

  if (manifest.appVersion && manifest.appVersion !== packageJson.version) {
    warnings.push(
      `This backup was made on app version ${manifest.appVersion}; this instance runs ${packageJson.version}.`,
    )
  }

  const current = await latestMigration()
  if (manifest.prismaMigration && current && manifest.prismaMigration !== current) {
    warnings.push(
      `Database schema differs (backup: ${manifest.prismaMigration}, here: ${current}). Restore may need review.`,
    )
  }

  return warnings
}
