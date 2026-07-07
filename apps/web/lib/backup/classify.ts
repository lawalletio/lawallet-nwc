import type { BackupConflict, BackupResolutionStrategy, BackupTableName } from '@/lib/validation/schemas'
import {
  type TableDescriptor,
  fieldsKey,
  pkKey,
} from '@/lib/backup/tables'
import { rowsEqual } from '@/lib/backup/serialize'

/**
 * Minimal shape shared by the Prisma client and an interactive transaction
 * client — just the delegates the backup engine reads through.
 */
export type DbClient = Record<string, { findMany: (args?: unknown) => Promise<unknown[]> }>

type Row = Record<string, unknown>

/** Friendly singular noun per table for conflict messages. */
const TABLE_NOUNS: Record<BackupTableName, string> = {
  users: 'user',
  cardDesigns: 'card design',
  ntag424s: 'card chip',
  remoteWallets: 'remote wallet',
  lightningAddresses: 'lightning address',
  cards: 'card',
  cardActivationTokens: 'activation token',
  albySubAccounts: 'Alby account',
  invoices: 'invoice',
  activityLogs: 'activity log',
  settings: 'setting',
  nostrProfileCache: 'cached profile',
  nostrProfileImageCache: 'cached image',
  pluginRecords: 'plugin record',
}

export function tableNoun(table: BackupTableName): string {
  return TABLE_NOUNS[table]
}

/** Pre-loaded lookups for classifying one table's incoming rows. */
export interface TableContext {
  existingByPk: Map<string, Row>
  /** secondary-unique label → comboKey → existing row */
  secondaryExisting: Map<string, Map<string, Row>>
  /** partial-unique label → scopeKey → existing row */
  partialExisting: Map<string, Map<string, Row>>
}

function delegate(db: DbClient, model: string) {
  return db[model]
}

/**
 * Batch-loads everything needed to classify `rows` of one table against the
 * live DB: existing rows by PK, by each secondary unique, and by each
 * partial-unique scope. All lookups are scoped to the incoming values so the
 * queries stay bounded.
 */
export async function loadTableContext(
  db: DbClient,
  desc: TableDescriptor,
  rows: Row[],
): Promise<TableContext> {
  const existingByPk = new Map<string, Row>()
  if (rows.length > 0) {
    let existing: Row[]
    if (desc.pk.length === 1) {
      const field = desc.pk[0]
      const values = rows.map(r => r[field])
      existing = (await delegate(db, desc.model).findMany({
        where: { [field]: { in: values } },
      })) as Row[]
    } else {
      const or = rows.map(r => Object.fromEntries(desc.pk.map(f => [f, r[f]])))
      existing = (await delegate(db, desc.model).findMany({ where: { OR: or } })) as Row[]
    }
    for (const e of existing) existingByPk.set(pkKey(desc, e), e)
  }

  const secondaryExisting = new Map<string, Map<string, Row>>()
  for (const su of desc.secondaryUniques) {
    const map = new Map<string, Row>()
    const combos = rows
      .filter(r => su.fields.every(f => r[f] !== null && r[f] !== undefined))
      .map(r => Object.fromEntries(su.fields.map(f => [f, r[f]])))
    if (combos.length > 0) {
      const existing = (await delegate(db, desc.model).findMany({ where: { OR: combos } })) as Row[]
      for (const e of existing) map.set(fieldsKey(su.fields, e), e)
    }
    secondaryExisting.set(su.label, map)
  }

  const partialExisting = new Map<string, Map<string, Row>>()
  for (const pu of desc.partialUniques) {
    const map = new Map<string, Row>()
    const applies = (r: Row) =>
      pu.flag ? r[pu.flag] === true : r[pu.where!.field] === pu.where!.equals
    const scoped = rows.filter(applies)
    if (scoped.length > 0) {
      const combos = scoped.map(r => Object.fromEntries(pu.scope.map(f => [f, r[f]])))
      const baseWhere = pu.flag
        ? { [pu.flag]: true }
        : { [pu.where!.field]: pu.where!.equals }
      const existing = (await delegate(db, desc.model).findMany({
        where: { AND: [baseWhere, { OR: combos }] },
      })) as Row[]
      for (const e of existing) map.set(fieldsKey(pu.scope, e), e)
    }
    partialExisting.set(pu.label, map)
  }

  return { existingByPk, secondaryExisting, partialExisting }
}

export type RowStatus = 'new' | 'identical' | 'conflicting'

export interface Classification {
  status: RowStatus
  conflict?: BackupConflict
}

function conflictId(table: BackupTableName, rowKey: string): string {
  return `${table}:${rowKey}`
}

interface ConflictInit {
  kind: BackupConflict['kind']
  message: string
  field?: string
  existingId?: string
  existingOwnerId?: string
  incomingValue?: unknown
  existingValue?: unknown
  allowedStrategies: BackupResolutionStrategy[]
  suggestedStrategy: BackupResolutionStrategy
}

export function makeConflict(
  desc: TableDescriptor,
  rowKey: string,
  init: ConflictInit,
): BackupConflict {
  return {
    id: conflictId(desc.name, rowKey),
    table: desc.name,
    kind: init.kind,
    rowKey,
    field: init.field,
    incomingValue: init.incomingValue,
    existingValue: init.existingValue,
    existingId: init.existingId,
    existingOwnerId: init.existingOwnerId,
    message: init.message,
    suggestedStrategy: init.suggestedStrategy,
    allowedStrategies: init.allowedStrategies,
  }
}

/**
 * Classifies a single validated row against the live DB. `isParentAvailable`
 * answers whether a required FK target exists (in the backup or the DB), so an
 * orphaned row is flagged rather than exploding a RESTRICT constraint later.
 * Returns exactly one bucket and at most one conflict per row.
 */
export function classifyRow(
  desc: TableDescriptor,
  row: Row,
  ctx: TableContext,
  isParentAvailable: (target: BackupTableName, value: unknown) => boolean,
): Classification {
  const rowKey = pkKey(desc, row)
  const existing = ctx.existingByPk.get(rowKey)

  if (existing) {
    if (rowsEqual(row, existing)) return { status: 'identical' }
    const ownerDiff =
      Boolean(desc.renameChangesPk) && 'userId' in row && existing.userId !== row.userId
    const allowed: BackupResolutionStrategy[] = ['skip', 'overwrite']
    if (desc.renameField) allowed.push('rename')
    return {
      status: 'conflicting',
      conflict: makeConflict(desc, rowKey, {
        kind: 'pk',
        message: ownerDiff
          ? `A ${tableNoun(desc.name)} "${rowKey}" already exists here, owned by a different account.`
          : `A ${tableNoun(desc.name)} "${rowKey}" already exists with different details.`,
        existingId: pkKey(desc, existing),
        existingOwnerId: typeof existing.userId === 'string' ? existing.userId : undefined,
        allowedStrategies: allowed,
        suggestedStrategy: ownerDiff ? 'rename' : 'skip',
      }),
    }
  }

  // Required FK target missing → cannot import this row on its own.
  for (const fk of desc.fks) {
    const value = row[fk.field]
    if (fk.required && value != null && !isParentAvailable(fk.target, value)) {
      return {
        status: 'conflicting',
        conflict: makeConflict(desc, rowKey, {
          kind: 'fk-target-missing',
          field: fk.field,
          message: `This ${tableNoun(desc.name)} points to a ${tableNoun(fk.target)} that isn't in the backup and doesn't exist here — it can't be restored on its own.`,
          allowedStrategies: ['skip'],
          suggestedStrategy: 'skip',
        }),
      }
    }
  }

  // Secondary UNIQUE owned by a different row.
  for (const su of desc.secondaryUniques) {
    if (!su.fields.every(f => row[f] !== null && row[f] !== undefined)) continue
    const hit = ctx.secondaryExisting.get(su.label)?.get(fieldsKey(su.fields, row))
    if (hit) {
      const renameable = Boolean(desc.renameField) && su.fields.includes(desc.renameField!)
      return {
        status: 'conflicting',
        conflict: makeConflict(desc, rowKey, {
          kind: 'secondary-unique',
          field: su.fields.join('+'),
          message: `A ${su.label} matching this ${tableNoun(desc.name)} already exists here.`,
          existingId: pkKey(desc, hit),
          existingOwnerId: typeof hit.userId === 'string' ? hit.userId : undefined,
          allowedStrategies: renameable ? ['skip', 'rename'] : ['skip'],
          suggestedStrategy: renameable ? 'rename' : 'skip',
        }),
      }
    }
  }

  // Partial-unique clash (one primary address / default wallet / pending token).
  for (const pu of desc.partialUniques) {
    const applies = pu.flag ? row[pu.flag] === true : row[pu.where!.field] === pu.where!.equals
    if (!applies) continue
    const hit = ctx.partialExisting.get(pu.label)?.get(fieldsKey(pu.scope, row))
    if (hit) {
      return {
        status: 'conflicting',
        conflict: makeConflict(desc, rowKey, {
          kind: 'partial-unique',
          field: pu.flag,
          message: `The backup sets a different ${pu.label} for this account than what exists here.`,
          existingId: pkKey(desc, hit),
          allowedStrategies: ['skip', 'overwrite'],
          suggestedStrategy: 'skip',
        }),
      }
    }
  }

  return { status: 'new' }
}
