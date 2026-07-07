import { prisma } from '@/lib/prisma'
import {
  type BackupImportRequest,
  type BackupImportResult,
  type BackupResolutionStrategy,
  type BackupTableName,
} from '@/lib/validation/schemas'
import {
  BACKUP_TABLE_ORDER,
  type TableDescriptor,
  TABLE_DESCRIPTORS,
  fieldsKey,
  pkKey,
  resolveTables,
} from '@/lib/backup/tables'
import { ROW_SCHEMAS, toPrismaData } from '@/lib/backup/row-schemas'
import { classifyRow, loadTableContext, type DbClient } from '@/lib/backup/classify'
import type { ParsedBackup } from '@/lib/backup/archive'

const IMPORT_TX_TIMEOUT_MS = 120_000
const IMPORT_TX_MAX_WAIT_MS = 20_000

type Row = Record<string, unknown>
/** Prisma delegates expose create/update/upsert/deleteMany/findMany — typed loose. */
type WriteClient = Record<string, any>

interface RenameEntry {
  old: string
  userId: unknown
  next: string
}

interface MergeState {
  /** LightningAddress renames, scoped by owner, for Card.username remap. */
  renames: RenameEntry[]
  /** PKs known to exist (DB-preexisting ∪ imported) per table. */
  livePks: Partial<Record<BackupTableName, Set<string>>>
  /** Partial-unique scopes already claimed this import (`table:flag:scope`). */
  claimedScopes: Set<string>
}

type TableResult = NonNullable<BackupImportResult['tables'][BackupTableName]>

function emptyTableResult(): TableResult {
  return { imported: 0, skipped: 0, overwritten: 0, renamed: 0, deleted: 0, failed: 0, notes: [] }
}

function pkWhere(desc: TableDescriptor, row: Row): Record<string, unknown> {
  if (desc.pk.length === 1) return { [desc.pk[0]]: row[desc.pk[0]] }
  const compound = desc.pk.join('_')
  return { [compound]: Object.fromEntries(desc.pk.map(f => [f, row[f]])) }
}

/** Loads DB-present PKs for this table's FK targets into `livePks`. */
async function prefetchFkTargets(db: DbClient, desc: TableDescriptor, rows: Row[], state: MergeState) {
  for (const fk of desc.fks) {
    const set = (state.livePks[fk.target] ??= new Set<string>())
    const missing = new Set<unknown>()
    for (const row of rows) {
      const value = row[fk.field]
      if (value == null) continue
      if (!set.has(String(value))) missing.add(value)
    }
    if (missing.size === 0) continue
    const tdesc = TABLE_DESCRIPTORS[fk.target]
    const field = tdesc.pk[0]
    const found = (await db[tdesc.model].findMany({
      where: { [field]: { in: [...missing] } },
      select: { [field]: true },
    })) as Row[]
    for (const f of found) set.add(String(f[field]))
  }
}

/** Rewrites denormalized references (Card.username) to a renamed target. */
function applySoftRefs(desc: TableDescriptor, row: Row, state: MergeState) {
  for (const sr of desc.softRefs) {
    const value = row[sr.field]
    if (value == null) continue
    const entry = state.renames.find(e => e.old === value && e.userId === row.userId)
    if (entry) row[sr.field] = entry.next
  }
}

/**
 * Nulls nullable FKs whose target is absent; signals a skip when a required FK
 * target is absent. Assumes `prefetchFkTargets` has run for this table.
 */
function fkGuard(desc: TableDescriptor, row: Row, state: MergeState): { skip: boolean } {
  for (const fk of desc.fks) {
    const value = row[fk.field]
    if (value == null) continue
    if (state.livePks[fk.target]?.has(String(value))) continue
    if (fk.required) return { skip: true }
    row[fk.field] = null
  }
  return { skip: false }
}

/**
 * Enforces the partial-unique invariants (one primary address / default wallet
 * per user, one pending token per card+kind) before writing a flagged row.
 * Mutates `row` (coercing a flag to false) or unsets the DB incumbent, per
 * `prefer`. Returns `{ skip: true }` for a predicate-based clash (pending token)
 * that should not be duplicated.
 */
async function reconcilePartialUniques(
  db: WriteClient,
  desc: TableDescriptor,
  row: Row,
  state: MergeState,
  prefer: boolean,
): Promise<{ skip: boolean }> {
  for (const pu of desc.partialUniques) {
    if (pu.flag) {
      if (row[pu.flag] !== true) continue
      const scopeKey = `${desc.name}:${pu.flag}:${fieldsKey(pu.scope, row)}`
      if (state.claimedScopes.has(scopeKey)) {
        row[pu.flag] = false
        continue
      }
      const where = { AND: [{ [pu.flag]: true }, ...pu.scope.map(f => ({ [f]: row[f] }))] }
      const existing = (await db[desc.model].findMany({ where })) as Row[]
      const other = existing.find(e => pkKey(desc, e) !== pkKey(desc, row))
      if (other) {
        if (prefer) {
          await db[desc.model].update({ where: pkWhere(desc, other), data: { [pu.flag]: false } })
        } else {
          row[pu.flag] = false
        }
      }
      state.claimedScopes.add(scopeKey)
    } else if (pu.where) {
      if (row[pu.where.field] !== pu.where.equals) continue
      const scopeKey = `${desc.name}:${pu.where.field}:${fieldsKey(pu.scope, row)}`
      if (state.claimedScopes.has(scopeKey)) return { skip: true }
      const where = {
        AND: [{ [pu.where.field]: pu.where.equals }, ...pu.scope.map(f => ({ [f]: row[f] }))],
      }
      const existing = (await db[desc.model].findMany({ where })) as Row[]
      const other = existing.find(e => pkKey(desc, e) !== pkKey(desc, row))
      if (other) return { skip: true }
      state.claimedScopes.add(scopeKey)
    }
  }
  return { skip: false }
}

/** Finds a free value for a renamed unique field by suffixing `-1`, `-2`, … */
async function uniqueValue(
  db: WriteClient,
  desc: TableDescriptor,
  field: string,
  base: string,
  extraWhere: Record<string, unknown>,
  taken: Set<string>,
): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${base}-${n}`
    if (taken.has(candidate)) continue
    const clash = await db[desc.model].findFirst({
      where: { ...extraWhere, [field]: candidate },
      select: { [field]: true },
    })
    if (!clash) return candidate
  }
  // Extremely unlikely; fall back to a timestamp-free unique-ish suffix.
  return `${base}-${taken.size + 1}`
}

/**
 * Applies a full restore. `merge` resolves conflicts row-by-row; `replace`
 * wipes the backed-up tables first, then inserts verbatim. Runs in one
 * transaction when `atomic` (default), else best-effort per table.
 */
export async function applyBackup(
  parsed: ParsedBackup,
  resolution: BackupImportRequest,
): Promise<BackupImportResult> {
  const tablesInScope = resolveTables(parsed.manifest.categories).filter(t => parsed.tables[t])

  // 1. Schema-validate; invalid rows are recorded as failed and never written.
  const validByTable: Partial<Record<BackupTableName, Row[]>> = {}
  const result: BackupImportResult = {
    mode: resolution.mode,
    tables: {},
    hadErrors: false,
    errors: [],
    importedAt: new Date().toISOString(),
  }
  for (const table of tablesInScope) {
    const tableResult = emptyTableResult()
    const schema = ROW_SCHEMAS[table]
    const valid: Row[] = []
    ;(parsed.tables[table] ?? []).forEach((raw, index) => {
      const res = schema.safeParse(raw)
      if (res.success) valid.push(res.data)
      else {
        tableResult.failed++
        tableResult.notes.push({ id: `row-${index}`, reason: 'invalid-row' })
      }
    })
    validByTable[table] = valid
    result.tables[table] = tableResult
  }

  const state: MergeState = { renames: [], livePks: {}, claimedScopes: new Set() }

  const perConflict = new Map(resolution.perConflict.map(p => [p.id, p.strategy]))
  const strategyFor = (conflictId: string, allowed: BackupResolutionStrategy[], suggested: BackupResolutionStrategy): BackupResolutionStrategy => {
    const override = perConflict.get(conflictId)
    if (override && allowed.includes(override)) return override
    if (resolution.defaultStrategy && allowed.includes(resolution.defaultStrategy)) {
      return resolution.defaultStrategy
    }
    return suggested
  }

  if (resolution.mode === 'replace') {
    await runReplace(tablesInScope, validByTable, state, result, resolution.atomic)
  } else {
    await runMerge(tablesInScope, validByTable, state, result, resolution, strategyFor)
  }

  result.hadErrors =
    result.errors.length > 0 ||
    Object.values(result.tables).some(t => (t?.failed ?? 0) > 0)
  return result
}

// ── Replace mode ─────────────────────────────────────────────────────────────

async function runReplace(
  tables: BackupTableName[],
  validByTable: Partial<Record<BackupTableName, Row[]>>,
  state: MergeState,
  result: BackupImportResult,
  atomic: boolean,
) {
  const apply = async (db: WriteClient) => {
    // Delete children-first so cascades/RESTRICTs are satisfied.
    for (const table of [...BACKUP_TABLE_ORDER].reverse()) {
      if (!tables.includes(table)) continue
      const desc = TABLE_DESCRIPTORS[table]
      const { count } = (await db[desc.model].deleteMany({})) as { count: number }
      result.tables[table]!.deleted += count
    }
    // Insert parents-first; every row is "new" against the now-empty tables.
    for (const table of tables) {
      const desc = TABLE_DESCRIPTORS[table]
      const rows = validByTable[table] ?? []
      await prefetchFkTargets(db as DbClient, desc, rows, state)
      for (const row of rows) {
        const outcome = await insertNewRow(db, desc, row, state, false)
        applyOutcome(result, table, outcome)
      }
    }
  }

  if (atomic) {
    await prisma.$transaction(async tx => apply(tx as unknown as WriteClient), {
      timeout: IMPORT_TX_TIMEOUT_MS,
      maxWait: IMPORT_TX_MAX_WAIT_MS,
    })
  } else {
    try {
      await prisma.$transaction(async tx => apply(tx as unknown as WriteClient), {
        timeout: IMPORT_TX_TIMEOUT_MS,
        maxWait: IMPORT_TX_MAX_WAIT_MS,
      })
    } catch (err) {
      result.errors.push({ message: err instanceof Error ? err.message : 'Replace failed' })
    }
  }
}

// ── Merge mode ───────────────────────────────────────────────────────────────

async function runMerge(
  tables: BackupTableName[],
  validByTable: Partial<Record<BackupTableName, Row[]>>,
  state: MergeState,
  result: BackupImportResult,
  resolution: BackupImportRequest,
  strategyFor: (id: string, allowed: BackupResolutionStrategy[], suggested: BackupResolutionStrategy) => BackupResolutionStrategy,
) {
  const processTable = async (db: WriteClient, table: BackupTableName) => {
    const desc = TABLE_DESCRIPTORS[table]
    const rows = validByTable[table] ?? []
    await prefetchFkTargets(db as DbClient, desc, rows, state)
    const isParentAvailable = (target: BackupTableName, value: unknown) =>
      Boolean(state.livePks[target]?.has(String(value)))
    const ctx = await loadTableContext(db as DbClient, desc, rows)

    for (const row of rows) {
      const { status, conflict } = classifyRow(desc, row, ctx, isParentAvailable)

      if (status === 'identical') {
        markLive(state, desc, row)
        result.tables[table]!.skipped++
        continue
      }
      if (status === 'new') {
        const outcome = await insertNewRow(db, desc, row, state, resolution.preferBackupPrimary)
        applyOutcome(result, table, outcome)
        continue
      }

      // conflicting
      const c = conflict!
      const strategy = strategyFor(c.id, c.allowedStrategies, c.suggestedStrategy)

      if (c.kind === 'fk-target-missing' || (c.kind !== 'partial-unique' && strategy === 'skip')) {
        result.tables[table]!.skipped++
        if (c.kind === 'fk-target-missing') {
          result.tables[table]!.notes.push({ id: c.id, reason: 'fk-target-missing' })
        }
        // A skipped PK-conflict keeps the existing (live) row; mark it available.
        if (c.kind === 'pk') markLive(state, desc, row)
        continue
      }

      if (c.kind === 'pk') {
        if (strategy === 'overwrite') {
          await reconcilePartialUniques(db, desc, row, state, resolution.preferBackupPrimary)
          await db[desc.model].upsert({
            where: pkWhere(desc, row),
            update: toPrismaData(desc.name, row),
            create: toPrismaData(desc.name, row),
          })
          markLive(state, desc, row)
          result.tables[table]!.overwritten++
        } else if (strategy === 'rename' && desc.renameChangesPk && desc.renameField) {
          await renamePkRow(db, desc, row, state, result, table)
        } else {
          result.tables[table]!.skipped++
          markLive(state, desc, row)
        }
        continue
      }

      if (c.kind === 'secondary-unique') {
        if (strategy === 'rename' && desc.renameField && !desc.renameChangesPk) {
          const base = String(row[desc.renameField])
          const next = await uniqueValue(
            db,
            desc,
            desc.renameField,
            base,
            { userId: row.userId },
            new Set(),
          )
          row[desc.renameField] = next
          const outcome = await insertNewRow(db, desc, row, state, resolution.preferBackupPrimary)
          if (outcome === 'imported') result.tables[table]!.renamed++
          else applyOutcome(result, table, outcome)
        } else {
          result.tables[table]!.skipped++
        }
        continue
      }

      if (c.kind === 'partial-unique') {
        // The row itself is new; import it, letting reconciliation settle the flag.
        const prefer = resolution.preferBackupPrimary || strategy === 'overwrite'
        const outcome = await insertNewRow(db, desc, row, state, prefer)
        applyOutcome(result, table, outcome)
        continue
      }
    }
  }

  if (resolution.atomic) {
    await prisma.$transaction(
      async tx => {
        for (const table of tables) await processTable(tx as unknown as WriteClient, table)
      },
      { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS },
    )
  } else {
    for (const table of tables) {
      try {
        await prisma.$transaction(async tx => processTable(tx as unknown as WriteClient, table), {
          timeout: IMPORT_TX_TIMEOUT_MS,
          maxWait: IMPORT_TX_MAX_WAIT_MS,
        })
      } catch (err) {
        result.tables[table]!.failed++
        result.errors.push({ table, message: err instanceof Error ? err.message : 'Import failed' })
      }
    }
  }
}

// ── Row helpers ──────────────────────────────────────────────────────────────

type InsertOutcome = 'imported' | 'skipped'

/** Inserts a brand-new row with FK, soft-ref, and partial-unique handling. */
async function insertNewRow(
  db: WriteClient,
  desc: TableDescriptor,
  row: Row,
  state: MergeState,
  prefer: boolean,
): Promise<InsertOutcome> {
  applySoftRefs(desc, row, state)
  if (fkGuard(desc, row, state).skip) return 'skipped'
  if ((await reconcilePartialUniques(db, desc, row, state, prefer)).skip) return 'skipped'
  await db[desc.model].create({ data: toPrismaData(desc.name, row) })
  markLive(state, desc, row)
  return 'imported'
}

/** Creates a renamed copy of a PK-conflicting row (LightningAddress.username). */
async function renamePkRow(
  db: WriteClient,
  desc: TableDescriptor,
  row: Row,
  state: MergeState,
  result: BackupImportResult,
  table: BackupTableName,
) {
  const field = desc.renameField!
  const base = String(row[field])
  const next = await uniqueValue(db, desc, field, base, {}, new Set(state.renames.map(r => r.next)))
  state.renames.push({ old: base, userId: row.userId, next })
  const renamed: Row = { ...row, [field]: next }
  applySoftRefs(desc, renamed, state)
  if (fkGuard(desc, renamed, state).skip) {
    result.tables[table]!.skipped++
    return
  }
  await reconcilePartialUniques(db, desc, renamed, state, false)
  await db[desc.model].create({ data: toPrismaData(desc.name, renamed) })
  markLive(state, desc, renamed)
  result.tables[table]!.renamed++
}

function markLive(state: MergeState, desc: TableDescriptor, row: Row) {
  ;(state.livePks[desc.name] ??= new Set<string>()).add(pkKey(desc, row))
}

function applyOutcome(result: BackupImportResult, table: BackupTableName, outcome: InsertOutcome) {
  if (outcome === 'imported') result.tables[table]!.imported++
  else result.tables[table]!.skipped++
}
