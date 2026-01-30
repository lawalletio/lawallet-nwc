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

export const POST = withErrorHandling(async (request: NextRequest) => {
  const data = await validateBody(request, jwtRequestSchema)

  // Get JWT secret from config
  const config = getConfig()

  if (!config.jwt.enabled || !config.jwt.secret) {
    logger.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  const jwtSecret = config.jwt.secret

  // Create JWT payload
  const payload = {
    sub: data.userId,
    ...data.additionalClaims
  }

  // Create JWT token
  const token = createJwtToken(payload, jwtSecret!, {
    expiresIn: parseInt(data.expiresIn),
    issuer: 'lawallet-nwc',
    audience: 'lawallet-users'
  })

  // Return the token
  return NextResponse.json({
    token,
    expiresIn: data.expiresIn,
    type: 'Bearer'
  })
})

// GET endpoint to validate a JWT token
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

  // Import the validation function
  const { validateJwtFromRequest } = await import('@/lib/jwt')

  try {
    // Validate the token
    const result = await validateJwtFromRequest(request, jwtSecret!, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })

    // Return token information (without sensitive data)
    return NextResponse.json({
      valid: true,
      userId: result.payload.sub,
      issuedAt: new Date(result.payload.iat * 1000).toISOString(),
      expiresAt: new Date(result.payload.exp * 1000).toISOString(),
      additionalClaims: Object.fromEntries(
        Object.entries(result.payload).filter(
          ([key]) => !['sub', 'iat', 'exp'].includes(key)
        )
      )
    })
  } catch (error) {
    logger.error({ err: error }, 'JWT validation error')
    throw new AuthenticationError('Invalid or expired token', {
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
