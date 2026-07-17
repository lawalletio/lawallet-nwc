import { z } from 'zod'

// ── Common ──────────────────────────────────────────────────────────────────

export const idParam = z.object({
  id: z.string().min(1, 'ID is required')
})

export const userIdParam = z.object({
  userId: z.string().min(1, 'User ID is required')
})

// ── Cards ───────────────────────────────────────────────────────────────────

export const createCardSchema = z.object({
  id: z.string().min(1, 'Card ID is required'),
  designId: z.string().min(1, 'Design ID is required'),
  /**
   * Card kind, declared at creation. Defaults to SIMPLE when omitted. MASTER is
   * reserved for the deferred account-share feature but is accepted here so the
   * field can be set ahead of that work landing.
   */
  kind: z.enum(['SIMPLE', 'MASTER']).optional()
})

export const cardListQuerySchema = z.object({
  paired: z.enum(['true', 'false']).optional(),
  used: z.enum(['true', 'false']).optional()
})

/**
 * Partial update for a card. Today only the wallet binding can change:
 *   - `remoteWalletId: string` rebinds the card to that wallet (must
 *     belong to the caller, must not be REVOKED — validated in the
 *     route handler since cross-field rules don't fit Zod cleanly).
 *   - `remoteWalletId: null` unbinds the card; spending falls back to
 *     the owner's default wallet at run-time.
 */
export const updateCardSchema = z.object({
  remoteWalletId: z.string().min(1).nullable()
})

export const updateWalletCardSchema = z
  .object({
    enabled: z.boolean().optional(),
    linkDefaultWallet: z.boolean().optional()
  })
  .refine(
    v =>
      (v.enabled !== undefined ? 1 : 0) +
        (v.linkDefaultWallet === true ? 1 : 0) ===
      1,
    { message: 'Provide exactly one card update action' }
  )

export const createCardDesignSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Design name is required')
    .max(120, 'Design name must be 120 characters or less'),
  imageUrl: z
    .string()
    .trim()
    .url('Image URL must be a valid URL')
    .max(2048, 'Image URL too long')
})

/**
 * Partial update for a card design. At least one field must be present —
 * the route handler rejects an empty payload so a no-op PATCH returns 400
 * rather than silently doing nothing.
 */
export const updateCardDesignSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, 'Design name is required')
      .max(120, 'Design name must be 120 characters or less')
      .optional(),
    imageUrl: z
      .string()
      .trim()
      .url('Image URL must be a valid URL')
      .max(2048, 'Image URL too long')
      .optional(),
    /**
     * Archive toggle. `true` stamps `archivedAt = now()`, `false` clears it.
     * The wire stays as a simple boolean so the client doesn't have to know
     * about the timestamp representation.
     */
    archived: z.boolean().optional()
  })
  .refine(
    v =>
      v.description !== undefined ||
      v.imageUrl !== undefined ||
      v.archived !== undefined,
    { message: 'No fields to update' }
  )

export const scanCardQuerySchema = z.object({
  p: z.string().min(1, 'Parameter p is required'),
  c: z.string().min(1, 'Parameter c is required')
})

export const payActionQuerySchema = z.object({
  pr: z
    .string()
    .min(1, 'Missing required parameter: pr')
    .max(8192, 'Payment request is too large')
})

export const cardScanCallbackQuerySchema = scanCardQuerySchema.merge(
  payActionQuerySchema
)

export const cardScanActionSchema = z.enum(['pay', 'new-otc'])
export type CardScanAction = z.infer<typeof cardScanActionSchema>

/** LUD-03 limits advertised by /scan and enforced again by /scan/cb. */
export const CARD_MIN_WITHDRAWABLE_MSATS = 1
export const CARD_MAX_WITHDRAWABLE_MSATS = 10_000_000

export const otcParam = z.object({
  otc: z.string().min(1, 'OTC parameter is required')
})

// ── Card activation tokens ──────────────────────────────────────────────────

/**
 * Mint an activation QR for a card. `qrKind` defaults to ONE_TIME (the only
 * kind wired this round — the route rejects FOREVER with a clear error).
 * `expiresIn` is an optional duration string (e.g. `24h`, `7d`); when omitted
 * the token does not expire.
 */
export const createActivationTokenSchema = z.object({
  qrKind: z.enum(['ONE_TIME', 'FOREVER']).default('ONE_TIME'),
  expiresIn: z.string().min(1).optional()
})

/**
 * Claim an activation token. For ONE_TIME tokens the claimer may name which
 * Remote Wallet funds the card; omitted/null falls back to the claimer's
 * default wallet at claim time.
 */
export const claimActivationTokenSchema = z.object({
  remoteWalletId: z.string().min(1).nullish()
})

// ── Lightning Addresses ─────────────────────────────────────────────────────

export const lud16UsernameParam = z.object({
  username: z.string().min(1)
})

/**
 * Maximum comment length allowed on LUD-16 callbacks (LUD-12).
 * Kept in sync with `commentAllowed` declared on the pay request.
 */
export const LUD12_MAX_COMMENT_LENGTH = 200

export const lud16CallbackQuerySchema = z.object({
  amount: z.string().min(1, 'Missing amount'),
  comment: z
    .string()
    .max(
      LUD12_MAX_COMMENT_LENGTH,
      `Comment exceeds ${LUD12_MAX_COMMENT_LENGTH} characters`
    )
    .optional()
})

export const updateLightningAddressSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(16, 'Username must be 16 characters or less')
    .regex(
      /^[a-z0-9]+$/,
      'Username must contain only lowercase letters and numbers'
    )
})

// ── Wallet Addresses (per-user, multi-address) ──────────────────────────────

/** URL parameter `username` for /api/wallet/addresses/[username] routes. */
export const walletAddressUsernameParam = z.object({
  username: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[a-z0-9]+$/, 'Invalid username')
})

export const lightningAddressModeSchema = z.enum([
  'IDLE',
  'ALIAS',
  'CUSTOM_NWC',
  'DEFAULT_NWC'
])

/** Body for POST /api/wallet/addresses (create). */
export const createWalletAddressSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(16, 'Username must be 16 characters or less')
    .regex(
      /^[a-z0-9]+$/,
      'Username must contain only lowercase letters and numbers'
    ),
  mode: lightningAddressModeSchema.optional()
})

/**
 * Body for PATCH /api/wallet/addresses/[username] (update).
 *
 * Cross-field rules (validated server-side, not via refine, so the route can
 * use the existing `validateBody` middleware without bespoke shapes):
 *   - mode === 'ALIAS'      → `redirect` is required and must look like an LN
 *                             address ("user@host").
 *   - mode === 'CUSTOM_NWC' → `remoteWalletId` is required and must reference
 *                             a RemoteWallet owned by the caller.
 *   - mode === 'IDLE' or 'DEFAULT_NWC' → both fields are ignored / cleared.
 */
export const updateWalletAddressSchema = z.object({
  mode: lightningAddressModeSchema,
  redirect: z
    .string()
    .max(254)
    .regex(
      /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
      'Must be a valid LN address'
    )
    .nullish(),
  remoteWalletId: z.string().min(1).nullish()
})

/** Body for POST /api/wallet/addresses/alias-probe. */
export const probeAliasAddressSchema = z.object({
  address: z
    .string()
    .trim()
    .max(254)
    .regex(
      /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
      'Must be a valid LN address'
    )
    .transform(value => value.toLowerCase())
})

// ── Users ───────────────────────────────────────────────────────────────────

export const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER'])
})

/** A single Nostr relay URL: must be a `ws://` or `wss://` URL. */
const relayUrl = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    value => {
      try {
        const { protocol, hostname } = new URL(value)
        return (
          (protocol === 'wss:' || protocol === 'ws:') && hostname.length > 0
        )
      } catch {
        return false
      }
    },
    { message: 'Relay must be a ws:// or wss:// URL' }
  )

/**
 * Update the caller's preferred Nostr relays. Deduped case-insensitively and
 * hard-capped at 20 (the "keep it under 7" guidance is a soft UI hint, not a
 * hard limit). An empty array clears the preference.
 */
export const updateUserRelaysSchema = z.object({
  relays: z
    .array(relayUrl)
    .max(20, 'Too many relays — keep the list short (20 max)')
    .transform(list => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const raw of list) {
        const url = raw.trim()
        const key = url.toLowerCase().replace(/\/+$/, '')
        if (seen.has(key)) continue
        seen.add(key)
        out.push(url)
      }
      return out
    })
})

// ── Settings ────────────────────────────────────────────────────────────────

export const settingsBodySchema = z.record(
  z
    .string()
    .min(1, 'Setting name cannot be empty')
    .max(32, 'Setting name cannot exceed 32 characters')
    .regex(
      /^[a-z0-9_-]+$/,
      'Setting name can only contain lowercase letters, numbers, hyphens, and underscores'
    ),
  z.string({ required_error: 'Value must be a string' })
)

// ── Remote Connections ──────────────────────────────────────────────────────

export const externalDeviceKeyParam = z.object({
  externalDeviceKey: z.string().min(1, 'External device key is required')
})

export const createRemoteCardSchema = z.object({
  designId: z.string().min(1, 'designId is required'),
  cardUID: z.string().min(1, 'cardUID is required')
})

// ── Invoices ───────────────────────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  purpose: z.enum(['registration', 'wallet-address']),
  metadata: z
    .object({
      username: z
        .string()
        .min(1, 'Username is required')
        .max(16, 'Username must be 16 characters or less')
        .regex(
          /^[a-z0-9]+$/,
          'Username must contain only lowercase letters and numbers'
        )
        .optional()
    })
    .optional()
})

export const claimInvoiceSchema = z.object({
  preimage: z
    .string()
    .min(1, 'Preimage is required')
    .regex(/^[a-f0-9]+$/i, 'Preimage must be a hex string')
})

// ── Remote Wallets ──────────────────────────────────────────────────────────

/**
 * Wallet name shown in the UI sidebar and pickers. Constraints mirror the
 * `(userId, name)` unique index in Prisma — uniqueness is enforced by the
 * DB, length by this schema.
 */
const remoteWalletName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(120, 'Name must be 120 characters or less')

/** Driver discriminator. Mirrors the `RemoteWalletType` enum in Prisma. */
const remoteWalletType = z.enum(['NWC', 'LND', 'CLN', 'BTCPAY'])

/**
 * Soft-state. `REVOKED` (manual soft-delete) and `DEAD` (an auto-archived
 * disposable LNCurl wallet that ran out of sats) are both terminal — clients
 * should not flip back from them.
 */
const remoteWalletStatus = z.enum(['ACTIVE', 'DISABLED', 'REVOKED', 'DEAD'])

/**
 * Body for `POST /api/remote-wallets`. `config` is passed through as
 * `unknown` and validated by the driver registry's per-type schema in the
 * route handler — keeping the discriminator + driver schema together in the
 * driver module rather than duplicating it here.
 */
export const createRemoteWalletSchema = z.object({
  name: remoteWalletName,
  type: remoteWalletType,
  config: z.unknown(),
  /** Compatibility shortcut: bind the primary address to this wallet. */
  isDefault: z.boolean().optional().default(false)
})

/**
 * Body for `POST /api/remote-wallets/lncurl`. The server mints the NWC
 * connection string from the configured LNCurl provider, so the client only
 * supplies an optional display name. `isDefault=true` is the compatibility
 * shortcut for binding the caller's primary Lightning Address to the new
 * wallet when one exists.
 */
export const createLncurlWalletSchema = z.object({
  name: remoteWalletName.optional(),
  isDefault: z.boolean().optional().default(false)
})

/**
 * Partial update for `PATCH /api/remote-wallets/[id]`. At least one field
 * must be present so a no-op PATCH returns 400 — matches the convention used
 * by `updateCardDesignSchema`.
 *
 * Note: this never accepts `config`. Rotating an NWC URI happens through a
 * dedicated endpoint (future) so the secret never travels in a generic
 * update payload.
 */
export const updateRemoteWalletSchema = z
  .object({
    name: remoteWalletName.optional(),
    isDefault: z.boolean().optional(),
    status: remoteWalletStatus.optional()
  })
  .refine(
    v =>
      v.name !== undefined ||
      v.isDefault !== undefined ||
      v.status !== undefined,
    { message: 'No fields to update' }
  )

/** Query params for `GET /api/remote-wallets`. */
export const remoteWalletListQuerySchema = z.object({
  /**
   * Filter by status. Defaults to "anything not revoked" so the UI doesn't
   * show dead wallets unless asked.
   */
  status: remoteWalletStatus.optional(),
  /** Filter by driver type — useful for the "NWC only" picker for now. */
  type: remoteWalletType.optional()
})

// ── JWT ─────────────────────────────────────────────────────────────────────

export const jwtRequestSchema = z.object({
  expiresIn: z.string().optional().default('1h')
})

// ── Device Tokens (QR-based JWT login, B.0) ──────────────────────────────────

/**
 * `expiresIn` accepts a `ms`-style duration (`30m`, `8h`, `7d`, `2w`) or a bare
 * number of seconds. The route enforces only a 1-minute floor (no maximum) —
 * device tokens are stateless and unrevocable, so prefer short lifetimes even
 * though long ones are allowed. Bounds are checked in the route, not here (this
 * package has no access to those constants).
 */
const deviceTokenExpiresIn = z
  .string()
  .trim()
  .regex(
    /^\d+\s*(s|m|h|d|w)?$/i,
    'Use a duration like 8h or 7d, or a number of seconds'
  )

/**
 * Body for `POST /api/auth/qr-jwt/generate`.
 *
 * The admin picks a target `userId`, ticks a `permissions` subset, and chooses
 * an `expiresIn`. Permission strings are validated against the real `Permission`
 * enum in the route handler (which also enforces they're a subset of the admin's
 * own RBAC) — keeping the enum's source of truth in the web app rather than
 * duplicating it into this shared package.
 */
export const qrJwtGenerateSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  permissions: z
    .array(z.string().min(1))
    .min(1, 'Select at least one permission')
    .max(64, 'Too many permissions'),
  expiresIn: deviceTokenExpiresIn.default('8h')
})

// ── Backup & Restore ─────────────────────────────────────────────────────────
//
// Contract shared by the export/analyze/import routes and the admin wizard.
// The per-table NDJSON row schemas that validate archive contents live in the
// web app (`apps/web/lib/backup/row-schemas.ts`) since they mirror the Prisma
// model shapes — they're an engine implementation detail, not an API contract.

/**
 * Bump on a backward-incompatible change to the archive layout. Import refuses
 * an archive whose `schemaVersion` is greater than this value.
 */
export const BACKUP_SCHEMA_VERSION = 1

/** Every table that can appear in a backup archive. */
export const backupTableName = z.enum([
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
  'pluginRecords'
])
export type BackupTableName = z.infer<typeof backupTableName>

/**
 * User-facing categories toggled in the export wizard. Each maps to one or more
 * tables (see `apps/web/lib/backup/tables.ts`). `core` bundles the essential
 * operational state; the rest are opt-in.
 */
export const backupCategoryEnum = z.enum([
  'core', // users, cardDesigns, ntag424s, remoteWallets, lightningAddresses, cards, cardActivationTokens, albySubAccounts
  'settings',
  'plugins',
  'activityLogs',
  'invoices',
  'nostrCache' // nostrProfileCache, nostrProfileImageCache
])
export type BackupCategory = z.infer<typeof backupCategoryEnum>

/** Bounds on how much of the large, append-only tables an export gathers. */
export const backupExportOptionsSchema = z
  .object({
    activityLogLimit: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .default(100_000),
    activityLogSince: z.string().datetime().optional()
  })
  .default({})

export const backupExportRequestSchema = z.object({
  categories: z
    .array(backupCategoryEnum)
    .min(1, 'Select at least one category'),
  /** When present, the archive is wrapped in an AES-256-GCM envelope. */
  password: z.string().min(1).optional(),
  options: backupExportOptionsSchema
})
export type BackupExportRequest = z.infer<typeof backupExportRequestSchema>

/** Per-table entry in `manifest.tables`. */
export const backupTableMetaSchema = z.object({
  count: z.number().int().nonnegative(),
  sha256: z.string(),
  /** True when an export cap (e.g. `activityLogLimit`) truncated the table. */
  truncated: z.boolean().optional()
})

export const backupManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  appVersion: z.string(),
  /** Latest applied Prisma migration id — informational, mismatch is a warning. */
  prismaMigration: z.string().nullable(),
  exportedAt: z.string(),
  encrypted: z.boolean().default(false),
  categories: z.array(backupCategoryEnum),
  tables: z.record(backupTableName, backupTableMetaSchema)
})
export type BackupManifest = z.infer<typeof backupManifestSchema>

/**
 * How a single incoming row clashes with the live DB:
 * - `pk`                — same primary key, different field values
 * - `secondary-unique`  — a secondary UNIQUE (pubkey/username/cid/paymentHash/…) owned by a different row
 * - `partial-unique`    — both backup and DB assert a user's primary address / default wallet, on different rows
 * - `invalid-row`       — the row failed its schema and cannot be imported
 * - `fk-target-missing` — a required FK target is neither in the backup nor the DB
 */
export const backupConflictKind = z.enum([
  'pk',
  'secondary-unique',
  'partial-unique',
  'invalid-row',
  'fk-target-missing'
])
export type BackupConflictKind = z.infer<typeof backupConflictKind>

export const backupResolutionStrategy = z.enum(['skip', 'overwrite', 'rename'])
export type BackupResolutionStrategy = z.infer<typeof backupResolutionStrategy>

export const backupConflictSchema = z.object({
  /** Stable id `${table}:${rowKey}` — the key the wizard maps resolutions by. */
  id: z.string(),
  table: backupTableName,
  kind: backupConflictKind,
  /** Primary key (or composite key string) of the incoming row. */
  rowKey: z.string(),
  /** The colliding field, when applicable (e.g. `username`, `pubkey`). */
  field: z.string().optional(),
  incomingValue: z.unknown().optional(),
  existingValue: z.unknown().optional(),
  existingId: z.string().optional(),
  existingOwnerId: z.string().optional(),
  /** Plain-language summary shown in the wizard. */
  message: z.string(),
  suggestedStrategy: backupResolutionStrategy,
  allowedStrategies: z.array(backupResolutionStrategy).min(1)
})
export type BackupConflict = z.infer<typeof backupConflictSchema>

export const backupTableCountsSchema = z.object({
  total: z.number().int(),
  new: z.number().int(),
  identical: z.number().int(),
  conflicting: z.number().int(),
  invalid: z.number().int()
})

export const backupTableAnalysisSchema = z.object({
  counts: backupTableCountsSchema,
  conflicts: z.array(backupConflictSchema)
})

export const backupAnalyzeResponseSchema = z.object({
  manifest: backupManifestSchema,
  tables: z.record(backupTableName, backupTableAnalysisSchema),
  warnings: z.array(z.string()),
  analyzedAt: z.string()
})
export type BackupAnalyzeResponse = z.infer<typeof backupAnalyzeResponseSchema>

/** Restore mode chosen at the start of the restore wizard. */
export const backupImportMode = z.enum(['merge', 'replace'])
export type BackupImportMode = z.infer<typeof backupImportMode>

export const backupImportRequestSchema = z.object({
  mode: backupImportMode.default('merge'),
  /** Applied to any conflict lacking a per-conflict override (merge mode). */
  defaultStrategy: z.enum(['skip', 'overwrite']).default('skip'),
  perConflict: z
    .array(
      z.object({
        id: z.string(),
        strategy: backupResolutionStrategy
      })
    )
    .default([]),
  /** On a primary-address / default-wallet clash, whether the backup wins. */
  preferBackupPrimary: z.boolean().default(false),
  /** All-or-nothing (one transaction) vs best-effort per table. */
  atomic: z.boolean().default(true)
})
export type BackupImportRequest = z.infer<typeof backupImportRequestSchema>

export const backupImportTableResultSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  overwritten: z.number().int(),
  renamed: z.number().int(),
  deleted: z.number().int(),
  failed: z.number().int(),
  notes: z.array(z.object({ id: z.string(), reason: z.string() }))
})

export const backupImportResultSchema = z.object({
  mode: backupImportMode,
  tables: z.record(backupTableName, backupImportTableResultSchema),
  hadErrors: z.boolean(),
  errors: z.array(
    z.object({
      table: backupTableName.optional(),
      id: z.string().optional(),
      message: z.string()
    })
  ),
  importedAt: z.string()
})
export type BackupImportResult = z.infer<typeof backupImportResultSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Passkeys (WebAuthn)
// ─────────────────────────────────────────────────────────────────────────────
// Structural validation only — deep cryptographic validation of the WebAuthn
// payloads belongs to @simplewebauthn/server on the route side.

export const passkeyLabelSchema = z.string().trim().min(1).max(64)

/** Minimal structural shape of a browser RegistrationResponseJSON. */
export const webauthnRegistrationResponseSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: z.string().min(1),
        attestationObject: z.string().min(1),
        transports: z.array(z.string()).optional()
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).default({}),
    authenticatorAttachment: z.string().optional()
  })
  .passthrough()

/** Minimal structural shape of a browser AuthenticationResponseJSON. */
export const webauthnAuthenticationResponseSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: z.string().min(1),
        authenticatorData: z.string().min(1),
        signature: z.string().min(1),
        userHandle: z.string().nullish()
      })
      .passthrough(),
    clientExtensionResults: z.record(z.unknown()).default({})
  })
  .passthrough()

export const passkeyRegistrationOptionsRequestSchema = z.object({
  label: passkeyLabelSchema.optional()
})

export const passkeyRegistrationVerifyRequestSchema = z.object({
  challenge: z.string().min(16).max(128),
  credential: webauthnRegistrationResponseSchema,
  label: passkeyLabelSchema.optional()
})
export type PasskeyRegistrationVerifyRequest = z.infer<
  typeof passkeyRegistrationVerifyRequestSchema
>

export const passkeyAuthenticationVerifyRequestSchema = z.object({
  challenge: z.string().min(16).max(128),
  credential: webauthnAuthenticationResponseSchema
})
export type PasskeyAuthenticationVerifyRequest = z.infer<
  typeof passkeyAuthenticationVerifyRequestSchema
>

/** nsec export = a fresh EXPORT-flow assertion, same wire shape as login verify. */
export const passkeyNsecExportRequestSchema =
  passkeyAuthenticationVerifyRequestSchema

export const updatePasskeyCredentialSchema = z.object({
  label: passkeyLabelSchema
})

export const passkeyCredentialSummarySchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  deviceType: z.string(),
  backedUp: z.boolean(),
  aaguid: z.string().nullable(),
  rpId: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable()
})
export type PasskeyCredentialSummary = z.infer<
  typeof passkeyCredentialSummarySchema
>

export const passkeyCredentialListResponseSchema = z.object({
  credentials: z.array(passkeyCredentialSummarySchema),
  /** True when the server custodies this account's Nostr key (passkey-native). */
  hasManagedKey: z.boolean()
})
export type PasskeyCredentialListResponse = z.infer<
  typeof passkeyCredentialListResponseSchema
>

/** Session token payload returned by passkey auth endpoints (mirrors /api/jwt). */
export const passkeySessionResponseSchema = z.object({
  token: z.string(),
  expiresIn: z.union([z.string(), z.number()]),
  type: z.literal('Bearer'),
  pubkey: z.string(),
  custody: z.enum(['managed', 'linked'])
})
export type PasskeySessionResponse = z.infer<typeof passkeySessionResponseSchema>
