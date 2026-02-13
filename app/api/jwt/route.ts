import { NextRequest, NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError,
} from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { jwtRequestSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateNip98 } from '@/lib/nip98'
import { getRolePermissions } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'

/**
 * POST /api/jwt - Authenticate with NIP-98, receive a JWT session token.
 *
 * The client signs a NIP-98 event (kind 27235) targeting this endpoint.
 * The server validates the Nostr signature, resolves the user's role,
 * and returns a JWT with pubkey, role, and permissions baked in.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)

  // 1. Validate NIP-98 authentication
  let pubkey: string
  try {
    const result = await validateNip98(request)
    pubkey = result.pubkey
  } catch (error) {
    throw new AuthenticationError('Invalid NIP-98 authentication', {
      details: error instanceof Error ? error.message : 'Invalid or missing Nostr auth',
    })
  }

  // 2. Parse optional body (expiresIn)
  let expiresIn = '1h'
  try {
    const data = await validateBody(request, jwtRequestSchema)
    expiresIn = data.expiresIn
  } catch {
    // Body is optional for this endpoint; default to 1h
  }

  // 3. Get JWT secret
  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  // 4. Resolve user role and permissions
  const role = await resolveRole(pubkey)
  const permissions = getRolePermissions(role)

  // 5. Create JWT with identity and authorization claims
  const token = createJwtToken(
    {
      userId: pubkey,
      pubkey,
      role,
      permissions,
    },
    config.jwt.secret,
    {
      expiresIn: parseInt(expiresIn) || expiresIn,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    }
  )

  return NextResponse.json({
    token,
    expiresIn,
    type: 'Bearer',
  })
})

/**
 * GET /api/jwt - Validate an existing JWT token.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    throw new AuthenticationError('Authorization header is required')
  }

  const config = getConfig()

  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  const jwtSecret = config.jwt.secret

  const { validateJwtFromRequest } = await import('@/lib/jwt')

  try {
    const result = await validateJwtFromRequest(request, jwtSecret!, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    })

    return NextResponse.json({
      valid: true,
      pubkey: result.payload.pubkey,
      role: result.payload.role,
      permissions: result.payload.permissions,
      issuedAt: new Date(result.payload.iat * 1000).toISOString(),
      expiresAt: new Date(result.payload.exp * 1000).toISOString(),
    })
  } catch (error) {
    logger.error({ err: error }, 'JWT validation error')
    throw new AuthenticationError('Invalid or expired token', {
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})
