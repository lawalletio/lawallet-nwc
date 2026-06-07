import { NextRequest, NextResponse } from 'next/server'
import { validateNip98 } from '@/lib/nip98'
import { validateJwtFromRequest, JwtValidationResult } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { AuthenticationError, AuthorizationError } from '@/types/server/errors'
import { Role, Permission, hasRole, hasPermission, isValidRole, isValidPermission } from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'
import { resolvePublicEndpoint } from '@/lib/public-url'

/** Normalizes a base URL for comparison: trim, drop a trailing slash, lowercase. */
function normalizeApiUrl(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\/+$/, '').toLowerCase()
    : ''
}

/** Authentication scheme used to identify the caller. */
export type AuthMethod = 'nip98' | 'jwt'

/** Resolved identity returned by the auth helpers. */
export interface AuthResult {
  /** Hex-encoded Nostr pubkey of the authenticated actor. */
  pubkey: string
  /** Role resolved for the actor (USER when nothing matched). */
  role: Role
  /** Scheme used for the request — useful for audit logging. */
  method: AuthMethod
  /**
   * Explicit permission scopes carried by a delegated device token (B.0).
   * When present, this is the actor's *effective* permission set:
   * {@link authenticateWithPermission} checks membership here instead of
   * deriving permissions from {@link role}. Absent for session JWTs and NIP-98,
   * which use the full role→permission map. See `mintDeviceToken`.
   */
  scopes?: Permission[]
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

    // Device tokens (B.0) carry an explicit `scopes` claim that narrows what the
    // token can do regardless of role. Only trust a well-formed array of known
    // permission strings; ignore anything malformed so a bad claim can never
    // *widen* access (the absence of `scopes` falls back to the role map).
    const rawScopes = result.payload.scopes
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter(
          (s: unknown): s is Permission =>
            typeof s === 'string' && isValidPermission(s),
        )
      : undefined

    // Device tokens (B.0) are scoped to the instance that minted them. Reject a
    // token whose `apiUrl` claim is missing or doesn't match this platform's URL
    // so a token issued for one instance can't be replayed against another. Only
    // device tokens carry `apiUrl`; session JWTs (no `kind`) are unaffected.
    if (result.payload.kind === 'device') {
      const { url } = await resolvePublicEndpoint(request)
      if (normalizeApiUrl(result.payload.apiUrl) !== normalizeApiUrl(url)) {
        throw new AuthenticationError('Token is not valid for this instance', {
          details: 'Device token apiUrl does not match this platform',
        })
      }
    }

    return { pubkey, role, method: 'jwt', scopes }
  } catch (error) {
    if (error instanceof AuthenticationError) throw error
    throw new AuthenticationError('Invalid or expired JWT', {
      details: error instanceof Error ? error.message : 'Invalid token',
    })
  }
}

/**
 * Authenticates and verifies the actor satisfies the role hierarchy.
 *
 * @throws {AuthenticationError} When the request lacks valid credentials.
 * @throws {AuthorizationError} When the resolved role is below `requiredRole`.
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
 * Authenticates and verifies the actor holds the given permission.
 *
 * @throws {AuthenticationError} When the request lacks valid credentials.
 * @throws {AuthorizationError} When the resolved role does not grant `permission`.
 */
export async function authenticateWithPermission(
  request: Request,
  permission: Permission
): Promise<AuthResult> {
  const auth = await authenticate(request)

  // A device token's `scopes` claim is authoritative — it's the explicit set
  // the admin delegated, already validated as a subset of their RBAC at mint
  // time. For every other caller, fall back to the role→permission map.
  const allowed = auth.scopes
    ? auth.scopes.includes(permission)
    : hasPermission(auth.role, permission)

  if (!allowed) {
    throw new AuthorizationError('Not authorized to perform this action')
  }

  return auth
}

/**
 * Wraps a route handler with unified auth (Nostr or JWT) and forwards the
 * resolved {@link AuthResult} as the second argument.
 *
 * @param handler - The handler to invoke after a successful auth.
 * @param options - Optional gate. `requireNip98` forces Nostr-only auth (used
 *   by endpoints that mint JWTs); otherwise checks `requiredPermission` first,
 *   then `requiredRole`, then plain authentication.
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
