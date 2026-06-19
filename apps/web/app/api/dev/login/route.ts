import { NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, InternalServerError } from '@/types/server/errors'
import { Role, getRolePermissions } from '@/lib/auth/permissions'
import { logger } from '@/lib/logger'

// Seeded admin identity (apps/web/mocks/user.ts user[0]); the e2e auth fixture
// mints sessions for the same pubkey.
const DEV_ADMIN_PUBKEY =
  'npub1xyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yz890'

/**
 * `POST /api/dev/login` — mint an ADMIN session JWT without the NIP-98 signing
 * dance. Strictly a local-development convenience powering the "Login as admin"
 * button in the dev banner.
 *
 * Allowlisted to local development: it returns 404 unless `NODE_ENV` is
 * explicitly `development`, so production, test, staging, or an unset env are
 * all locked out — you have to opt in deliberately. The button that calls it is
 * gated the same way, so this is double-gated.
 */
export const POST = withErrorHandling(async (_request: Request) => {
  if (process.env.NODE_ENV !== 'development') {
    throw new NotFoundError('Not found')
  }

  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('JWT_SECRET is not configured')
  }

  const token = createJwtToken(
    {
      userId: DEV_ADMIN_PUBKEY,
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
