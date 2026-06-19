import { z } from 'zod'

// ── Common ──────────────────────────────────────────────────────────────────

export const idParam = z.object({
  id: z.string().min(1, 'ID is required'),
})

export const userIdParam = z.object({
  userId: z.string().min(1, 'User ID is required'),
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
  kind: z.enum(['SIMPLE', 'MASTER']).optional(),
})

export const cardListQuerySchema = z.object({
  paired: z.enum(['true', 'false']).optional(),
  used: z.enum(['true', 'false']).optional(),
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
  remoteWalletId: z.string().min(1).nullable(),
})

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
    .max(2048, 'Image URL too long'),
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
    archived: z.boolean().optional(),
  })
  .refine(
    v =>
      v.description !== undefined ||
      v.imageUrl !== undefined ||
      v.archived !== undefined,
    { message: 'No fields to update' },
  )

export const scanCardQuerySchema = z.object({
  p: z.string().min(1, 'Parameter p is required'),
  c: z.string().min(1, 'Parameter c is required'),
})

export const payActionQuerySchema = z.object({
  pr: z.string().min(1, 'Missing required parameter: pr'),
})

export const otcParam = z.object({
  otc: z.string().min(1, 'OTC parameter is required'),
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
  expiresIn: z.string().min(1).optional(),
})

/**
 * Claim an activation token. For ONE_TIME tokens the claimer may name which
 * Remote Wallet funds the card; omitted/null falls back to the claimer's
 * default wallet at claim time.
 */
export const claimActivationTokenSchema = z.object({
  remoteWalletId: z.string().min(1).nullish(),
})

// ── Lightning Addresses ─────────────────────────────────────────────────────

export const lud16UsernameParam = z.object({
  username: z.string().min(1),
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
    .max(LUD12_MAX_COMMENT_LENGTH, `Comment exceeds ${LUD12_MAX_COMMENT_LENGTH} characters`)
    .optional(),
})

export const updateLightningAddressSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(16, 'Username must be 16 characters or less')
    .regex(/^[a-z0-9]+$/, 'Username must contain only lowercase letters and numbers'),
})

// ── Wallet Addresses (per-user, multi-address) ──────────────────────────────

/** URL parameter `username` for /api/wallet/addresses/[username] routes. */
export const walletAddressUsernameParam = z.object({
  username: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[a-z0-9]+$/, 'Invalid username'),
})

export const lightningAddressModeSchema = z.enum([
  'IDLE',
  'ALIAS',
  'CUSTOM_NWC',
  'DEFAULT_NWC',
])

/** Body for POST /api/wallet/addresses (create). */
export const createWalletAddressSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(16, 'Username must be 16 characters or less')
    .regex(/^[a-z0-9]+$/, 'Username must contain only lowercase letters and numbers'),
  mode: lightningAddressModeSchema.optional(),
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
    .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i, 'Must be a valid LN address')
    .nullish(),
  remoteWalletId: z.string().min(1).nullish(),
})

// ── Users ───────────────────────────────────────────────────────────────────

export const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER']),
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
  z.string({ required_error: 'Value must be a string' }),
)

// ── Remote Connections ──────────────────────────────────────────────────────

export const externalDeviceKeyParam = z.object({
  externalDeviceKey: z.string().min(1, 'External device key is required'),
})

export const createRemoteCardSchema = z.object({
  designId: z.string().min(1, 'designId is required'),
  cardUID: z.string().min(1, 'cardUID is required'),
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
        .regex(/^[a-z0-9]+$/, 'Username must contain only lowercase letters and numbers')
        .optional(),
    })
    .optional(),
})

export const claimInvoiceSchema = z.object({
  preimage: z
    .string()
    .min(1, 'Preimage is required')
    .regex(/^[a-f0-9]+$/i, 'Preimage must be a hex string'),
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
  /** When `true`, the new wallet becomes the user's default (un-marks the previous one in the same transaction). */
  isDefault: z.boolean().optional().default(false),
})

/**
 * Body for `POST /api/remote-wallets/lncurl`. The server mints the NWC
 * connection string from the configured LNCurl provider, so the client only
 * supplies an optional display name. The new wallet always becomes the
 * caller's default and inherits the previous wallet's address/card bindings,
 * so there's no `isDefault` flag here.
 */
export const createLncurlWalletSchema = z.object({
  name: remoteWalletName.optional(),
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
    status: remoteWalletStatus.optional(),
  })
  .refine(
    v => v.name !== undefined || v.isDefault !== undefined || v.status !== undefined,
    { message: 'No fields to update' },
  )

/** Query params for `GET /api/remote-wallets`. */
export const remoteWalletListQuerySchema = z.object({
  /**
   * Filter by status. Defaults to "anything not revoked" so the UI doesn't
   * show dead wallets unless asked.
   */
  status: remoteWalletStatus.optional(),
  /** Filter by driver type — useful for the "NWC only" picker for now. */
  type: remoteWalletType.optional(),
})

// ── JWT ─────────────────────────────────────────────────────────────────────

export const jwtRequestSchema = z.object({
  expiresIn: z.string().optional().default('1h'),
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
    'Use a duration like 8h or 7d, or a number of seconds',
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
  expiresIn: deviceTokenExpiresIn.default('8h'),
})
