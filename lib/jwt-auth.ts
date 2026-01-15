import { NextRequest, NextResponse } from 'next/server'
import { validateJwtFromRequest, JwtValidationResult } from './jwt'
import { getConfig } from './config'
import {
  AuthenticationError,
  AuthorizationError,
  InternalServerError
} from '@/types/server/errors'

export interface JwtAuthOptions {
  algorithms?: string[]
  issuer?: string
  audience?: string
  clockTolerance?: number
  requiredClaims?: string[]
}

export interface AuthenticatedRequest extends NextRequest {
  jwt?: JwtValidationResult
}

/**
 * Middleware function to authenticate JWT tokens in API routes
 * @param request - The Next.js request object
 * @param options - JWT validation options
 * @returns Promise<JwtValidationResult> - Returns token data when authentication succeeds
 */
export async function authenticateJwt(
  request: NextRequest,
  options: JwtAuthOptions = {}
): Promise<JwtValidationResult> {
  try {
    const config = getConfig()

    if (!config.jwt.enabled || !config.jwt.secret) {
      console.error('JWT_SECRET environment variable is not set')
      throw new InternalServerError('Server configuration error')
    }

    const jwtSecret = config.jwt.secret

    // Validate the JWT token
    const result = await validateJwtFromRequest(request, jwtSecret!, {
      algorithms: options.algorithms as any,
      issuer: options.issuer || 'lawallet-nwc',
      audience: options.audience || 'lawallet-users',
      clockTolerance: options.clockTolerance
    })

    // Check required claims if specified
    if (options.requiredClaims) {
      for (const claim of options.requiredClaims) {
        if (!(claim in result.payload)) {
          throw new AuthorizationError(`Missing required claim: ${claim}`)
        }
      }
    }

    return result
  } catch (error) {
    console.error('JWT authentication error:', error)

    throw new AuthenticationError('Authentication failed', {
      details:
        error instanceof Error ? error.message : 'Invalid or expired token',
      cause: error
    })
  }
}

/**
 * Higher-order function to wrap API route handlers with JWT authentication
 * @param handler - The API route handler function
 * @param options - JWT authentication options
 * @returns Function - Wrapped handler with authentication
 */
export function withJwtAuth<T extends any[]>(
  handler: (request: AuthenticatedRequest, ...args: T) => Promise<NextResponse>,
  options: JwtAuthOptions = {}
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const authResult = await authenticateJwt(request, options)
    ;(request as AuthenticatedRequest).jwt = authResult

    // Authentication successful, call the original handler
    return handler(request as AuthenticatedRequest, ...args)
  }
}

/**
 * Extracts user ID from authenticated request
 * @param request - The authenticated request object
 * @returns string - The user ID from the JWT payload
 */
export function getUserIdFromRequest(request: AuthenticatedRequest): string {
  if (!request.jwt) {
    throw new AuthenticationError('Request not authenticated')
  }

  return request.jwt.payload.userId
}

/**
 * Extracts additional claims from authenticated request
 * @param request - The authenticated request object
 * @param claimKey - The claim key to extract
 * @returns any - The claim value
 */
export function getClaimFromRequest<T = any>(
  request: AuthenticatedRequest,
  claimKey: string
): T {
  if (!request.jwt) {
    throw new AuthenticationError('Request not authenticated')
  }

  return request.jwt.payload[claimKey] as T
}

/**
 * Checks if the authenticated user has a specific claim
 * @param request - The authenticated request object
 * @param claimKey - The claim key to check
 * @param expectedValue - The expected value (optional, just checks existence if not provided)
 * @returns boolean - True if the claim exists and matches expected value
 */
export function hasClaim(
  request: AuthenticatedRequest,
  claimKey: string,
  expectedValue?: any
): boolean {
  if (!request.jwt) {
    return false
  }

  const claimValue = request.jwt.payload[claimKey]

  if (expectedValue !== undefined) {
    return claimValue === expectedValue
  }

  return claimValue !== undefined
}
