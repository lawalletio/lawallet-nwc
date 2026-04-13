import { NextRequest, NextResponse } from 'next/server'
import { validateNip98 } from '@/lib/nip98'
import { validateJwtFromRequest, JwtValidationResult } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'
import { Role, Permission, hasRole, hasPermission, isValidRole } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'

export type AuthMethod = 'nip98' | 'jwt'

export interface AuthResult {
  pubkey: string
  role: Role
  method: AuthMethod
}

/**
 * Authenticates a request using either NIP-98 (Nostr) or JWT (Bearer).
 *
 * Detects the auth method from the Authorization header:
 * - "Nostr <base64>" -> NIP-98 validation + DB role lookup
 * - "Bearer <jwt>"   -> JWT validation with role from claims
 *
 * @param request - The incoming request
 * @returns AuthResult with pubkey, role, and method used
 * @throws AuthenticationError if no valid auth is found
 */
export async function authenticate(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    throw new AuthenticationError('Authorization header is required')
  }

  if (authHeader.startsWith('Nostr ')) {
    return authenticateNip98(request)
  }

  if (authHeader.startsWith('Bearer ')) {
    return authenticateJwt(request)
  }

  throw new AuthenticationError('Authorization header must use "Nostr" or "Bearer" scheme')
}

async function authenticateNip98(request: Request): Promise<AuthResult> {
  try {
    const { pubkey } = await validateNip98(request)
    const role = await resolveRole(pubkey)
    return { pubkey, role, method: 'nip98' }
  } catch (error) {
    throw new AuthenticationError('Invalid NIP-98 authentication', {
      details: error instanceof Error ? error.message : 'Invalid Nostr auth',
    })
  }
}

async function authenticateJwt(request: Request): Promise<AuthResult> {
  const config = getConfig()

  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new AuthenticationError('JWT authentication is not configured')
  }

  try {
    const result = await validateJwtFromRequest(request, config.jwt.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    })

    const pubkey = result.payload.pubkey
    if (!pubkey) {
      throw new AuthenticationError('JWT missing pubkey claim')
    }

    const role = isValidRole(result.payload.role) ? result.payload.role : Role.USER

    return { pubkey, role, method: 'jwt' }
  } catch (error) {
    if (error instanceof AuthenticationError) throw error
    throw new AuthenticationError('Invalid or expired JWT', {
      details: error instanceof Error ? error.message : 'Invalid token',
    })
  }
}

/**
 * Authenticates and checks that the user has at least the required role.
 */
export async function authenticateWithRole(
  request: Request,
  requiredRole: Role
): Promise<AuthResult> {
  const auth = await authenticate(request)

  if (!hasRole(auth.role, requiredRole)) {
    throw new AuthorizationError('Not authorized to access this resource')
  }

  return auth
}

/**
 * Authenticates and checks that the user has a specific permission.
 */
export async function authenticateWithPermission(
  request: Request,
  permission: Permission
): Promise<AuthResult> {
  const auth = await authenticate(request)

  if (!hasPermission(auth.role, permission)) {
    throw new AuthorizationError('Not authorized to perform this action')
  }

  return auth
}

/**
 * HOF: wraps a route handler with unified auth (Nostr or JWT).
 */
export function withAuth<T extends any[]>(
  handler: (request: Request, auth: AuthResult, ...args: T) => Promise<NextResponse>,
  options?: { requiredRole?: Role; requiredPermission?: Permission; requireNip98?: boolean }
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    let auth: AuthResult

    if (options?.requireNip98) {
      auth = await authenticateNip98(request)
    } else if (options?.requiredPermission) {
      auth = await authenticateWithPermission(request, options.requiredPermission)
    } else if (options?.requiredRole) {
      auth = await authenticateWithRole(request, options.requiredRole)
    } else {
      auth = await authenticate(request)
    }

    return handler(request, auth, ...args)
  }
}
