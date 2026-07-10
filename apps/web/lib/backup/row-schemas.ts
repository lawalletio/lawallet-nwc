import { z } from 'zod'
import { Prisma } from '@/lib/generated/prisma'
import type { BackupTableName } from '@/lib/validation/schemas'
import { TABLE_DESCRIPTORS } from '@/lib/backup/tables'

/**
 * Per-table Zod schemas that validate a decoded NDJSON row before it can be
 * imported. Hand-derived from the Prisma models (Prisma emits no Zod), so
 * import stays strict and independent of the live DB. Date columns use
 * `z.coerce.date()` so ISO strings deserialize to `Date` ready for Prisma;
 * nullable date/`json` columns keep `null` via `.nullable()`.
 */

// Enums mirror prisma/schema.prisma exactly.
const userRole = z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER'])
const lightningAddressMode = z.enum([
  'IDLE',
  'ALIAS',
  'CUSTOM_NWC',
  'DEFAULT_NWC'
])
const remoteWalletType = z.enum(['NWC', 'LND', 'CLN', 'BTCPAY'])
const remoteWalletStatus = z.enum(['ACTIVE', 'DISABLED', 'REVOKED', 'DEAD'])
const cardKind = z.enum(['SIMPLE', 'MASTER'])
const activationQrKind = z.enum(['ONE_TIME', 'FOREVER'])
const activationTokenStatus = z.enum([
  'PENDING',
  'CLAIMED',
  'REVOKED',
  'EXPIRED'
])
const invoicePurpose = z.enum([
  'REGISTRATION',
  'WALLET_ADDRESS',
  'LUD16_PAYMENT'
])
const invoiceStatus = z.enum(['PENDING', 'PAID', 'EXPIRED'])
const activityCategory = z.enum([
  'USER',
  'ADDRESS',
  'NWC',
  'INVOICE',
  'CARD',
  'SERVER'
])
const activityLevel = z.enum(['INFO', 'WARN', 'ERROR'])
const nostrProfileImageKind = z.enum(['AVATAR', 'COVER'])

const date = z.coerce.date()
const nullableDate = z.coerce.date().nullable()
// Opaque Json columns — passed through untouched.
const json = z.unknown()

const userRow = z.object({
  id: z.string().min(1),
  pubkey: z.string().min(1),
  createdAt: date,
  albyEnabled: z.boolean(),
  role: userRole,
  relays: z.string().nullable(),
  relaysUpdatedAt: nullableDate
})

const cardDesignRow = z.object({
  id: z.string().min(1),
  imageUrl: z.string(),
  description: z.string(),
  createdAt: date,
  archivedAt: nullableDate,
  userId: z.string().nullable()
})

const ntag424Row = z.object({
  cid: z.string().min(1),
  k0: z.string(),
  k1: z.string(),
  k2: z.string(),
  k3: z.string(),
  k4: z.string(),
  ctr: z.number().int(),
  createdAt: date,
  userId: z.string().nullable()
})

const remoteWalletRow = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string(),
  type: remoteWalletType,
  config: json,
  status: remoteWalletStatus,
  isDefault: z.boolean(),
  createdAt: date,
  updatedAt: date,
  diedAt: nullableDate
})

const lightningAddressRow = z.object({
  username: z.string().min(1),
  userId: z.string().min(1),
  mode: lightningAddressMode,
  redirect: z.string().nullable(),
  remoteWalletId: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: date,
  updatedAt: date
})

const cardRow = z.object({
  id: z.string().min(1),
  designId: z.string().min(1),
  ntag424Cid: z.string().nullable(),
  createdAt: date,
  title: z.string().nullable(),
  lastUsedAt: nullableDate,
  userId: z.string().nullable(),
  username: z.string().nullable(),
  otc: z.string().nullable(),
  remoteWalletId: z.string().nullable(),
  kind: cardKind,
  writeToken: z.string().nullable(),
  writeTokenExpiresAt: nullableDate,
  blockedAt: nullableDate,
  disabledAt: nullableDate
})

const cardActivationTokenRow = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  qrKind: activationQrKind,
  status: activationTokenStatus,
  qrPayload: z.string(),
  issuedByUserId: z.string().nullable(),
  expiresAt: nullableDate,
  claimedAt: nullableDate,
  claimedByUserId: z.string().nullable(),
  createdAt: date
})

const albySubAccountRow = z.object({
  appId: z.number().int(),
  userId: z.string().min(1),
  username: z.string().nullable(),
  nwcUri: z.string(),
  nostrPubkey: z.string().nullable(),
  createdAt: date
})

const settingsRow = z.object({
  name: z.string().min(1),
  value: z.string(),
  createdAt: date,
  updatedAt: date
})

const invoiceRow = z.object({
  id: z.string().min(1),
  bolt11: z.string(),
  paymentHash: z.string().min(1),
  amountSats: z.number().int(),
  description: z.string(),
  purpose: invoicePurpose,
  metadata: json.nullable(),
  status: invoiceStatus,
  preimage: z.string().nullable(),
  userId: z.string().nullable(),
  expiresAt: date,
  paidAt: nullableDate,
  createdAt: date
})

const activityLogRow = z.object({
  id: z.string().min(1),
  createdAt: date,
  category: activityCategory,
  level: activityLevel,
  event: z.string(),
  message: z.string(),
  reqId: z.string().nullable(),
  userId: z.string().nullable(),
  metadata: json.nullable()
})

const nostrProfileCacheRow = z.object({
  npub: z.string().min(1),
  pubkey: z.string().min(1),
  name: z.string().nullable(),
  displayName: z.string().nullable(),
  about: z.string().nullable(),
  nip05: z.string().nullable(),
  lud16: z.string().nullable(),
  website: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  kind0CreatedAt: nullableDate,
  rawMetadata: json.nullable(),
  fetchedAt: nullableDate,
  lastFetchAttemptAt: nullableDate,
  lastFetchError: z.string().nullable(),
  createdAt: date,
  updatedAt: date
})

const nostrProfileImageCacheRow = z.object({
  npub: z.string().min(1),
  kind: nostrProfileImageKind,
  remoteUrl: z.string(),
  cachePath: z.string().nullable(),
  contentType: z.string().nullable(),
  byteSize: z.number().int().nullable(),
  sha256: z.string().nullable(),
  cachedAt: nullableDate,
  failedAt: nullableDate,
  lastError: z.string().nullable(),
  createdAt: date,
  updatedAt: date
})

const pluginRecordRow = z.object({
  id: z.string().min(1),
  pluginId: z.string(),
  kind: z.string(),
  key: z.string(),
  data: json,
  createdAt: date,
  updatedAt: date
})

export const ROW_SCHEMAS: Record<
  BackupTableName,
  z.ZodType<Record<string, unknown>>
> = {
  users: userRow,
  cardDesigns: cardDesignRow,
  ntag424s: ntag424Row,
  remoteWallets: remoteWalletRow,
  lightningAddresses: lightningAddressRow,
  cards: cardRow,
  cardActivationTokens: cardActivationTokenRow,
  albySubAccounts: albySubAccountRow,
  invoices: invoiceRow,
  activityLogs: activityLogRow,
  settings: settingsRow,
  nostrProfileCache: nostrProfileCacheRow,
  nostrProfileImageCache: nostrProfileImageCacheRow,
  pluginRecords: pluginRecordRow
}

/**
 * Prepares a validated row for a Prisma `create`/`update`: a nullable Json
 * column carrying `null` must be written as `Prisma.DbNull`, not plain `null`.
 * Returns a fresh object (never mutates the input).
 */
export function toPrismaData(
  table: BackupTableName,
  row: Record<string, unknown>
): Record<string, unknown> {
  const desc = TABLE_DESCRIPTORS[table]
  if (desc.jsonNullableFields.length === 0) return { ...row }
  const out: Record<string, unknown> = { ...row }
  for (const field of desc.jsonNullableFields) {
    if (out[field] === null) out[field] = Prisma.DbNull
  }
  return out
}
