import { NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError } from '@/types/server/errors'
import { Role, getRolePermissions } from '@/lib/auth/permissions'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { logger } from '@/lib/logger'
import { DEV_ADMIN_PUBKEY, DEV_ADMIN_USER_ID } from '@/lib/dev-identity'

/**
 * `POST /api/dev/login` — mint an ADMIN session JWT without the NIP-98 signing
 * dance. Strictly a local-development convenience powering the "Login as admin"
 * button in the dev banner.
 *
 * Gated by {@link assertDevRoutesEnabled}: 404 in production and everywhere
 * without the explicit `ENABLE_DEV_ROUTES=true` opt-in. The button that calls
 * it is gated by environment too, so this is double-gated.
 */
export const POST = withErrorHandling(async (_request: Request) => {
  assertDevRoutesEnabled()

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('JWT_SECRET is not configured')
  }

  // The session-JWT role claim is only a hint — every request re-resolves it
  // from the DB. Make sure the dev admin identity exists with the ADMIN role
  // or the minted token would silently degrade to USER.
  await prisma.user.upsert({
    where: { id: DEV_ADMIN_USER_ID },
    update: { pubkey: DEV_ADMIN_PUBKEY, role: 'ADMIN' },
    create: { id: DEV_ADMIN_USER_ID, pubkey: DEV_ADMIN_PUBKEY, role: 'ADMIN' }
  })

  const token = createJwtToken(
    {
      userId: DEV_ADMIN_USER_ID,
      pubkey: DEV_ADMIN_PUBKEY,
      role: Role.ADMIN,
      permissions: getRolePermissions(Role.ADMIN)
    },
    config.jwt.secret,
    { expiresIn: '12h', issuer: 'lawallet-nwc', audience: 'lawallet-users' }
  )

  logger.warn('[dev] Admin JWT minted via /api/dev/login')

  return NextResponse.json({ token, type: 'Bearer' })
})
