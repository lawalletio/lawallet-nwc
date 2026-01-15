import { NextRequest, NextResponse } from 'next/server'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { z } from 'zod'

// Schema for JWT token request
const jwtRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  expiresIn: z.string().optional().default('1h'),
  additionalClaims: z.record(z.any()).optional()
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request body
    const validatedData = jwtRequestSchema.parse(body)

    // Get JWT secret from config
    const config = getConfig()

    if (!config.jwt.enabled || !config.jwt.secret) {
      console.error('JWT_SECRET environment variable is not set')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const jwtSecret = config.jwt.secret

    // Create JWT payload
    const payload = {
      sub: validatedData.userId,
      ...validatedData.additionalClaims
    }

    // Create JWT token
    const token = createJwtToken(payload, jwtSecret!, {
      expiresIn: parseInt(validatedData.expiresIn),
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })

    // Return the token
    return NextResponse.json({
      token,
      expiresIn: validatedData.expiresIn,
      type: 'Bearer'
    })
  } catch (error) {
    console.error('JWT token creation error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create JWT token' },
      { status: 500 }
    )
  }
}

// GET endpoint to validate a JWT token
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')

    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authorization header is required' },
        { status: 401 }
      )
    }

    const config = getConfig()

    if (!config.jwt.enabled || !config.jwt.secret) {
      console.error('JWT_SECRET environment variable is not set')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const jwtSecret = config.jwt.secret

    // Import the validation function
    const { validateJwtFromRequest } = await import('@/lib/jwt')

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

    return NextResponse.json(
      {
        error: 'Invalid or expired token',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 401 }
    )
  }
}
