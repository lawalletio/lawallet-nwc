import { createJwtToken } from '@/lib/jwt'
import { Permission, Role } from '@/lib/auth/permissions'
import { ValidationError } from '@/types/server/errors'

/** Lower bound for a device token's lifetime, in seconds (1 minute). */
export const MIN_DEVICE_TOKEN_SECONDS = 60

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
}

/**
 * Parses a duration string into whole seconds.
 *
 * Accepts `ms`-style values (`30m`, `8h`, `7d`, `2w`) and bare integers, which
 * are interpreted as **seconds** — not milliseconds, unlike `vercel/ms` (the
 * same footgun the legacy `/api/jwt` route guards against by coercing numeric
 * strings to `Number`).
 *
 * @throws {ValidationError} When the input doesn't match the expected shape.
 */
export function parseDurationSeconds(input: string): number {
  const match = /^(\d+)\s*(s|m|h|d|w)?$/i.exec(input.trim())
  if (!match) {
    throw new ValidationError('Invalid expiration', `Could not parse "${input}"`)
  }
  const value = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()
  return value * UNIT_SECONDS[unit]
}

/**
 * Validates `expiresIn` and returns the value to hand to `jsonwebtoken`.
 *
 * Bare-number strings are returned as a `number` (seconds) so `jsonwebtoken`
 * doesn't misread them as milliseconds; unit strings (`8h`, `7d`) pass through
 * unchanged. Enforces only a lower bound ({@link MIN_DEVICE_TOKEN_SECONDS}) —
 * there is no maximum lifetime, so operators can mint long-lived tokens for the
 * card apps. These tokens can't be revoked, so prefer the shortest lifetime
 * that fits the use case.
 *
 * @throws {ValidationError} When the duration is unparseable or below the minimum.
 */
export function normalizeDeviceTokenExpiry(input: string): string | number {
  const seconds = parseDurationSeconds(input)
  if (seconds < MIN_DEVICE_TOKEN_SECONDS) {
    throw new ValidationError('Expiration too short', 'Minimum is 1 minute')
  }
  // Bare number → return seconds as a number; unit string → pass through so
  // `jsonwebtoken` interprets it via `ms()`.
  return /^\d+$/.test(input.trim()) ? seconds : input.trim()
}

/** Parameters for {@link mintDeviceToken}. */
export interface MintDeviceTokenParams {
  /** Hex pubkey of the target user the device acts as. */
  pubkey: string
  /** DB id of the target user — recorded as the JWT `sub` for auditing. */
  userId: string
  /** Resolved role of the target user (drives role-gated routes). */
  role: Role
  /** Granted permission scopes — the device's effective permission set. */
  scopes: Permission[]
  /** Validated expiry (unit string like `8h`, or numeric seconds). */
  expiresIn: string | number
  /** JWT signing secret. */
  secret: string
}

/**
 * Mints a stateless device JWT for the QR-login flow (B.0).
 *
 * The token carries the target user's identity (`pubkey`) and `role` plus an
 * explicit `scopes` claim that narrows permission-gated routes to exactly the
 * granted set — see `authenticateWithPermission` in `unified-auth.ts`. There is
 * no server-side record: validation is signature + `exp` only, which is why the
 * caller bounds the lifetime via {@link normalizeDeviceTokenExpiry}.
 *
 * `iss`/`aud` mirror the session JWT so the token authenticates against the
 * same `Bearer` path; `kind: 'device'` marks it as a delegated token for audits.
 */
export function mintDeviceToken(params: MintDeviceTokenParams): string {
  const { pubkey, userId, role, scopes, expiresIn, secret } = params
  return createJwtToken(
    {
      // `userId` mirrors `pubkey` to match the session JWT shape the auth layer
      // expects; the canonical DB id travels in `sub` below.
      userId: pubkey,
      pubkey,
      role,
      // Mirror scopes into the legacy `permissions` claim so anything reading it
      // sees the narrowed set, and into `scopes` which the auth layer enforces.
      permissions: scopes,
      scopes,
      sub: userId,
      kind: 'device',
    },
    secret,
    {
      expiresIn,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    },
  )
}
