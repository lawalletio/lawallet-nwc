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
})

export const cardListQuerySchema = z.object({
  paired: z.enum(['true', 'false']).optional(),
  used: z.enum(['true', 'false']).optional(),
})

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
 *   - mode === 'CUSTOM_NWC' → `nwcConnectionId` is required and must reference
 *                             a connection owned by the caller.
 *   - mode === 'IDLE' or 'DEFAULT_NWC' → both fields are ignored / cleared.
 */
export const updateWalletAddressSchema = z.object({
  mode: lightningAddressModeSchema,
  redirect: z
    .string()
    .max(254)
    .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i, 'Must be a valid LN address')
    .nullish(),
  nwcConnectionId: z.string().min(1).nullish(),
})

export const nwcModeSchema = z.enum(['RECEIVE', 'SEND_RECEIVE'])

/**
 * Body for POST /api/wallet/nwc-connections.
 *
 * `connectionString` must look like a Nostr Wallet Connect URI so we reject
 * pasted garbage before reaching the DB. We don't verify the relays are
 * reachable here — that's the listener's job at runtime.
 */
export const createNwcConnectionSchema = z.object({
  connectionString: z
    .string()
    .min(1, 'Connection string is required')
    .max(2048, 'Connection string is too long')
    .regex(/^nostr\+walletconnect:\/\//i, 'Must start with nostr+walletconnect://'),
  mode: nwcModeSchema.optional(),
  isPrimary: z.boolean().optional(),
})

// ── Users ───────────────────────────────────────────────────────────────────

export const updateNwcSchema = z.object({
  nwcUri: z.string().min(1, 'NWC URI is required'),
})

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
  purpose: z.enum(['registration']),
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

// ── JWT ─────────────────────────────────────────────────────────────────────

export const jwtRequestSchema = z.object({
  expiresIn: z.string().optional().default('1h'),
})


