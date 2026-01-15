import { NextRequest, NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { z } from 'zod'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError,
  ValidationError
} from '@/types/server/errors'

// Schema for JWT token request
const jwtRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  expiresIn: z.string().optional().default('1h'),
  additionalClaims: z.record(z.any()).optional()
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json()

  // Validate request body
  const validatedData = jwtRequestSchema.safeParse(body)
  if (!validatedData.success) {
    throw new ValidationError('Invalid request data', validatedData.error.errors)
  }

  // Get JWT secret from config
  const config = getConfig()

  if (!config.jwt.enabled || !config.jwt.secret) {
    console.error('JWT_SECRET environment variable is not set')
    throw new InternalServerError('Server configuration error')
  }

  const jwtSecret = config.jwt.secret

  // Create JWT payload
  const payload = {
    sub: validatedData.data.userId,
    ...validatedData.data.additionalClaims
  }

  // Create JWT token
  const token = createJwtToken(payload, jwtSecret!, {
    expiresIn: parseInt(validatedData.data.expiresIn),
    issuer: 'lawallet-nwc',
    audience: 'lawallet-users'
  })

  // Return the token
  return NextResponse.json({
    token,
    expiresIn: validatedData.data.expiresIn,
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
    console.error('JWT_SECRET environment variable is not set')
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
    console.error('JWT validation error:', error)
    throw new AuthenticationError('Invalid or expired token', {
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
