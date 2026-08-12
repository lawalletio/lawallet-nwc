import { NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { Role, getRolePermissions } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { logger } from '@/lib/logger'
import { authenticateWithRole } from '@/lib/auth/unified-auth'

/**
 * `POST /api/dev/impersonate` — mint a session JWT for an arbitrary user's
 * pubkey (with their real, DB-resolved role) so an authenticated admin can
 * view the app exactly as that user.
 *
 * Strictly a local-development tool: gated by {@link assertDevRoutesEnabled}
 * (404 in production and without `ENABLE_DEV_ROUTES=true`). The UI is also
 * gated by environment and ADMIN role. It is the impersonation sibling of
 * `/api/dev/login`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertDevRoutesEnabled()

  await authenticateWithRole(request, Role.ADMIN)

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('JWT_SECRET is not configured')
  }

  const body = (await request.json().catch(() => null)) as {
    pubkey?: unknown
  } | null
  const pubkey = typeof body?.pubkey === 'string' ? body.pubkey.trim() : ''
  if (!pubkey) {
    throw new ValidationError('pubkey is required')
  }

  // Impersonate with the target's actual role so the session behaves like them.
  const role = await resolveRole(pubkey)

  const token = createJwtToken(
    {
      userId: pubkey,
      pubkey,
      role,
      permissions: getRolePermissions(role)
    },
    config.jwt.secret,
    { expiresIn: '12h', issuer: 'lawallet-nwc', audience: 'lawallet-users' }
  )

  logger.warn(
    { pubkey, role },
    '[dev] Impersonation JWT minted via /api/dev/impersonate'
  )

  return NextResponse.json({ token, type: 'Bearer', pubkey, role })
})
