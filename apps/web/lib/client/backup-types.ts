import type {
  BackupCategory,
  BackupConflict,
  BackupImportMode,
  BackupImportRequest,
  BackupImportResult,
  BackupResolutionStrategy,
  BackupTableName,
} from '@/lib/validation/schemas'

export type {
  BackupCategory,
  BackupConflict,
  BackupImportMode,
  BackupImportRequest,
  BackupImportResult,
  BackupResolutionStrategy,
  BackupTableName,
}
export type { BackupAnalyzeResponse } from '@/lib/validation/schemas'

/** Distinct error codes the analyze/import routes return for the password flow. */
export const BACKUP_PASSWORD_REQUIRED = 'BACKUP_PASSWORD_REQUIRED'
export const BACKUP_PASSWORD_INVALID = 'BACKUP_PASSWORD_INVALID'

/** UI metadata for the export category checklist. */
export interface CategoryMeta {
  key: BackupCategory
  label: string
  description: string
  defaultOn: boolean
}

export const BACKUP_CATEGORIES: CategoryMeta[] = [
  {
    key: 'core',
    label: 'Core data',
    description:
      'Users, lightning addresses, remote wallets, cards, designs, NTAG keys, activation tokens, and Alby accounts.',
    defaultOn: true,
  },
  {
    key: 'settings',
    label: 'System settings',
    description: 'Domain, branding, and infrastructure configuration.',
    defaultOn: true,
  },
  {
    key: 'plugins',
    label: 'Plugins',
    description: 'Installed plugin state.',
    defaultOn: true,
  },
  {
    key: 'activityLogs',
    label: 'Activity logs',
    description: 'The audit trail. Can be large.',
    defaultOn: false,
  },
  {
    key: 'invoices',
    label: 'Invoices',
    description: 'Lightning invoice history.',
    defaultOn: false,
  },
  {
    key: 'nostrCache',
    label: 'Nostr cache',
    description: 'Cached Nostr profiles and images (re-fetchable).',
    defaultOn: false,
  },
]

/** Human, plural labels per table for the review UI. */
export const TABLE_LABELS: Record<BackupTableName, string> = {
  users: 'Users',
  cardDesigns: 'Card designs',
  ntag424s: 'Card chips (NTAG424)',
  remoteWallets: 'Remote wallets',
  lightningAddresses: 'Lightning addresses',
  cards: 'Cards',
  cardActivationTokens: 'Activation tokens',
  albySubAccounts: 'Alby accounts',
  invoices: 'Invoices',
  activityLogs: 'Activity logs',
  settings: 'Settings',
  nostrProfileCache: 'Cached profiles',
  nostrProfileImageCache: 'Cached images',
  pluginRecords: 'Plugin records',
}

export function tableLabel(table: BackupTableName): string {
  return TABLE_LABELS[table] ?? table
}
