import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import {
  Role,
  Permission,
  getRolePermissions,
  isValidPermission,
} from '@/lib/auth/permissions'
import { qrJwtGenerateSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  AuthorizationError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import {
  mintDeviceToken,
  normalizeDeviceTokenExpiry,
} from '@/lib/auth/device-token'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `POST /api/auth/qr-jwt/generate` — mint a stateless device token (B.0).
 *
 * Admin-only. The admin picks a target user, a permission subset, and an
 * expiration; we sign a JWT that the third-party card apps (`card-installer`,
 * `simple-card-manager`) scan from an on-screen QR. There is no session record
 * and no revocation surface — validation is signature + `exp` only. There is no
 * maximum lifetime (only a 1-minute floor via `normalizeDeviceTokenExpiry`), so
 * prefer the shortest expiration that fits the device.
 *
 * The granted `permissions` must be a subset of the admin's own RBAC; the
 * token's `scopes` claim then narrows every permission-gated route to exactly
 * that set. The token authenticates *as the target user* (its `pubkey` + role),
 * so role-gated routes still respect that user's role — scopes only constrain
 * permission-gated routes.
 *
 * Body: `{ userId, permissions: string[], expiresIn: string }` → `{ jwt, … }`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')

  // Accepts Nostr *or* Bearer — the dashboard calls this with its session JWT.
  const admin = await authenticateWithRole(request, Role.ADMIN)

  // Rate-limit per admin (not per IP) so one operator behind a shared proxy
  // can't exhaust another's bucket.
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: `qr-jwt:${admin.pubkey}`,
    isAuthenticated: true,
  })

  const body = await validateBody(request, qrJwtGenerateSchema)

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET is not set — cannot mint device tokens')
    throw new InternalServerError('Server configuration error')
  }

  // Validate every requested permission is real *and* one the admin holds.
  // ADMIN holds all permissions today, so the subset check mainly guards
  // against typos — and keeps the endpoint safe if a lower role is ever
  // allowed to mint tokens.
  const adminPermissions = new Set<string>(getRolePermissions(admin.role))
  const scopes: Permission[] = []
  for (const raw of body.permissions) {
    if (!isValidPermission(raw)) {
      throw new ValidationError('Unknown permission', raw)
    }
    if (!adminPermissions.has(raw)) {
      throw new AuthorizationError('Cannot grant a permission you do not hold', raw)
    }
    if (!scopes.includes(raw)) scopes.push(raw)
  }

  // Resolve the target user the device will act as.
  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, pubkey: true, role: true },
  })
  if (!user) throw new NotFoundError('User not found')

  const expiresIn = normalizeDeviceTokenExpiry(body.expiresIn)

  const jwt = mintDeviceToken({
    pubkey: user.pubkey,
    userId: user.id,
    role: user.role as Role,
    scopes,
    expiresIn,
    secret: config.jwt.secret,
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_DEVICE_TOKEN_ISSUED,
    message: `Device token issued for ${user.pubkey.slice(0, 8)}… (${scopes.length} scope${scopes.length === 1 ? '' : 's'})`,
    userId: user.id,
    metadata: {
      issuedBy: admin.pubkey,
      targetPubkey: user.pubkey,
      scopes,
      expiresIn: String(expiresIn),
    },
  })

  return NextResponse.json({
    jwt,
    expiresIn,
    scopes,
    user: { id: user.id, pubkey: user.pubkey, role: user.role },
  })
})
