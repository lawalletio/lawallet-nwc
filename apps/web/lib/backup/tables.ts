import type { BackupCategory, BackupTableName } from '@/lib/validation/schemas'

/**
 * Canonical, topological (parents-first) order of every backup table. Import
 * inserts in this order so foreign keys always resolve; delete (replace mode)
 * walks it in reverse.
 */
export const BACKUP_TABLE_ORDER: BackupTableName[] = [
  'users',
  'cardDesigns',
  'ntag424s',
  'remoteWallets',
  'lightningAddresses',
  'cards',
  'cardActivationTokens',
  'albySubAccounts',
  'invoices',
  'activityLogs',
  'settings',
  'nostrProfileCache',
  'nostrProfileImageCache',
  'pluginRecords',
]

/** Maps a user-facing category to the tables it covers. */
export const CATEGORY_TABLES: Record<BackupCategory, BackupTableName[]> = {
  core: [
    'users',
    'cardDesigns',
    'ntag424s',
    'remoteWallets',
    'lightningAddresses',
    'cards',
    'cardActivationTokens',
    'albySubAccounts',
  ],
  settings: ['settings'],
  plugins: ['pluginRecords'],
  activityLogs: ['activityLogs'],
  invoices: ['invoices'],
  nostrCache: ['nostrProfileCache', 'nostrProfileImageCache'],
}

/** Categories pre-selected in the export wizard. */
export const DEFAULT_EXPORT_CATEGORIES: BackupCategory[] = ['core', 'settings', 'plugins']

export interface SecondaryUnique {
  /** Columns that together form the UNIQUE constraint. */
  fields: string[]
  /** Human label used in conflict messages. */
  label: string
}

export interface FkDescriptor {
  /** FK column on this table. */
  field: string
  /** Referenced table. */
  target: BackupTableName
  /**
   * true  → required / RESTRICT: a row whose target is missing cannot import
   *         (it is skipped, cascading to its own children).
   * false → nullable / SET NULL: a missing target just nulls the field.
   */
  required: boolean
}

/**
 * A denormalized, non-enforced reference (no DB-level FK) that must still be
 * rewritten when the target's primary key is renamed. Today: `Card.username`
 * points at a `LightningAddress.username`.
 */
export interface SoftRef {
  field: string
  target: BackupTableName
}

/**
 * A partial-unique constraint: at most one row per `scope` may satisfy the
 * predicate. Expressed either as a boolean `flag` (whose `true` rows are
 * constrained — isPrimary/isDefault) or a `where` predicate (status = PENDING).
 */
export interface PartialUnique {
  label: string
  scope: string[]
  flag?: string
  where?: { field: string; equals: unknown }
}

export interface TableDescriptor {
  name: BackupTableName
  /** Prisma client delegate accessor (e.g. `prisma.user`). */
  model: string
  /** Primary-key field(s). */
  pk: string[]
  /** True when the sole PK is numeric (AlbySubAccount.appId). */
  numericPk?: boolean
  secondaryUniques: SecondaryUnique[]
  fks: FkDescriptor[]
  softRefs: SoftRef[]
  partialUniques: PartialUnique[]
  /** Nullable Json columns — a JSON `null` must become `Prisma.DbNull`. */
  jsonNullableFields: string[]
  /** Field suffixed on a `rename` resolution (username / wallet name). */
  renameField?: string
  /** Whether renaming changes the PK (LightningAddress.username: yes). */
  renameChangesPk?: boolean
}

export const TABLE_DESCRIPTORS: Record<BackupTableName, TableDescriptor> = {
  users: {
    name: 'users',
    model: 'user',
    pk: ['id'],
    secondaryUniques: [{ fields: ['pubkey'], label: 'Nostr identity' }],
    fks: [],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  cardDesigns: {
    name: 'cardDesigns',
    model: 'cardDesign',
    pk: ['id'],
    secondaryUniques: [],
    fks: [{ field: 'userId', target: 'users', required: false }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  ntag424s: {
    name: 'ntag424s',
    model: 'ntag424',
    pk: ['cid'],
    secondaryUniques: [],
    fks: [{ field: 'userId', target: 'users', required: false }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  remoteWallets: {
    name: 'remoteWallets',
    model: 'remoteWallet',
    pk: ['id'],
    secondaryUniques: [{ fields: ['userId', 'name'], label: 'wallet name' }],
    fks: [{ field: 'userId', target: 'users', required: true }],
    softRefs: [],
    partialUniques: [{ label: 'default wallet', scope: ['userId'], flag: 'isDefault' }],
    jsonNullableFields: [],
    renameField: 'name',
    renameChangesPk: false,
  },
  lightningAddresses: {
    name: 'lightningAddresses',
    model: 'lightningAddress',
    pk: ['username'],
    secondaryUniques: [],
    fks: [
      { field: 'userId', target: 'users', required: true },
      { field: 'remoteWalletId', target: 'remoteWallets', required: false },
    ],
    softRefs: [],
    partialUniques: [{ label: 'primary address', scope: ['userId'], flag: 'isPrimary' }],
    jsonNullableFields: [],
    renameField: 'username',
    renameChangesPk: true,
  },
  cards: {
    name: 'cards',
    model: 'card',
    pk: ['id'],
    secondaryUniques: [
      { fields: ['ntag424Cid'], label: 'card chip (NTAG cid)' },
      { fields: ['writeToken'], label: 'write token' },
    ],
    fks: [
      { field: 'designId', target: 'cardDesigns', required: true },
      { field: 'ntag424Cid', target: 'ntag424s', required: false },
      { field: 'userId', target: 'users', required: false },
      { field: 'remoteWalletId', target: 'remoteWallets', required: false },
    ],
    softRefs: [{ field: 'username', target: 'lightningAddresses' }],
    partialUniques: [],
    jsonNullableFields: [],
  },
  cardActivationTokens: {
    name: 'cardActivationTokens',
    model: 'cardActivationToken',
    pk: ['id'],
    secondaryUniques: [],
    fks: [{ field: 'cardId', target: 'cards', required: true }],
    softRefs: [],
    partialUniques: [
      {
        label: 'pending activation token',
        scope: ['cardId', 'qrKind'],
        where: { field: 'status', equals: 'PENDING' },
      },
    ],
    jsonNullableFields: [],
  },
  albySubAccounts: {
    name: 'albySubAccounts',
    model: 'albySubAccount',
    pk: ['appId'],
    numericPk: true,
    secondaryUniques: [{ fields: ['userId'], label: 'Alby account (one per user)' }],
    fks: [{ field: 'userId', target: 'users', required: true }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  invoices: {
    name: 'invoices',
    model: 'invoice',
    pk: ['id'],
    secondaryUniques: [{ fields: ['paymentHash'], label: 'invoice (payment hash)' }],
    fks: [{ field: 'userId', target: 'users', required: false }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: ['metadata'],
  },
  activityLogs: {
    name: 'activityLogs',
    model: 'activityLog',
    pk: ['id'],
    secondaryUniques: [],
    fks: [{ field: 'userId', target: 'users', required: false }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: ['metadata'],
  },
  settings: {
    name: 'settings',
    model: 'settings',
    pk: ['name'],
    secondaryUniques: [],
    fks: [],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  nostrProfileCache: {
    name: 'nostrProfileCache',
    model: 'nostrProfileCache',
    pk: ['npub'],
    secondaryUniques: [{ fields: ['pubkey'], label: 'cached profile' }],
    fks: [],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: ['rawMetadata'],
  },
  nostrProfileImageCache: {
    name: 'nostrProfileImageCache',
    model: 'nostrProfileImageCache',
    pk: ['npub', 'kind'],
    secondaryUniques: [],
    fks: [{ field: 'npub', target: 'nostrProfileCache', required: true }],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
  pluginRecords: {
    name: 'pluginRecords',
    model: 'pluginRecord',
    pk: ['id'],
    secondaryUniques: [{ fields: ['pluginId', 'kind', 'key'], label: 'plugin record' }],
    fks: [],
    softRefs: [],
    partialUniques: [],
    jsonNullableFields: [],
  },
}

/** Union of the tables covered by `categories`, in canonical order, deduped. */
export function resolveTables(categories: BackupCategory[]): BackupTableName[] {
  const wanted = new Set<BackupTableName>()
  for (const category of categories) {
    for (const table of CATEGORY_TABLES[category] ?? []) wanted.add(table)
  }
  return BACKUP_TABLE_ORDER.filter(table => wanted.has(table))
}

const KEY_SEP = ''

/** Stable string key for a row from its primary-key field(s). */
export function pkKey(desc: TableDescriptor, row: Record<string, unknown>): string {
  return desc.pk.map(field => String(row[field])).join(KEY_SEP)
}

/** Stable key for an arbitrary set of column values (secondary uniques, scopes). */
export function fieldsKey(fields: string[], row: Record<string, unknown>): string {
  return fields.map(field => String(row[field])).join(KEY_SEP)
}
