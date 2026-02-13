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

export const lud16CallbackQuerySchema = z.object({
  amount: z.string().min(1, 'Missing amount'),
})

export const updateLightningAddressSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(16, 'Username must be 16 characters or less')
    .regex(/^[a-z0-9]+$/, 'Username must contain only lowercase letters and numbers'),
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

// ── JWT ─────────────────────────────────────────────────────────────────────

export const jwtRequestSchema = z.object({
  expiresIn: z.string().optional().default('1h'),
})

// ── Waitlist ────────────────────────────────────────────────────────────────

export const waitlistSchema = z.object({
  email: z.string().email('Email must be a valid email address'),
  name: z.string().min(1).optional(),
})

