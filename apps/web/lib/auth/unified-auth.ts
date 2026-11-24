import { validateNip98 } from '@/lib/nip98'
import { validateJwtFromRequest, JwtValidationResult } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import {
  ApiError,
  AuthenticationError,
  AuthorizationError
} from '@/types/server/errors'
import {
  Role,
  Permission,
  hasRole,
  hasPermission,
  isValidRole,
  isValidPermission
} from '@/lib/auth/permissions'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getSettings } from '@/lib/settings'
import { parseEndpoint } from '@/lib/public-url-utils'

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
  /**
   * `true` when the caller is a delegated device token (`kind: 'device'`).
   * Such a token may only reach handlers that gate every branch it can hit
   * with a permission check — see {@link AuthenticateOptions.allowDeviceToken}.
   */
  deviceToken?: boolean
}

/** Options for {@link authenticate}. */
export interface AuthenticateOptions {
  /**
   * Accept a delegated device token. Off by default: a device token narrows
   * its holder to an explicit permission set, so it must never satisfy a
   * role gate or act as its owner on owner-scoped routes (wallet secrets,
   * account changes, backups). Only pass `true` from a handler where every
   * branch reachable by the token is checked with {@link authHasPermission},
   * and where any "is this the owner" branch also checks `!auth.deviceToken`.
   */
  allowDeviceToken?: boolean
}

/** JWT `kind` values accepted as API credentials (`undefined` = session). */
const ACCEPTED_JWT_KINDS = new Set<unknown>([undefined, 'device'])

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
export async function authenticate(
  request: Request,
  options: AuthenticateOptions = {}
): Promise<AuthResult> {
  const auth = await authenticateAnyCredential(request)
  if (auth.deviceToken && !options.allowDeviceToken) {
    throw new AuthorizationError(
      'Device tokens can only call permission-scoped endpoints'
    )
  }
  return auth
}

async function authenticateAnyCredential(
  request: Request
): Promise<AuthResult> {
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

  throw new AuthenticationError(
    'Authorization header must use "Nostr" or "Bearer" scheme'
  )
}

async function authenticateNip98(request: Request): Promise<AuthResult> {
  try {
    const { pubkey } = await validateNip98(request)
    const role = await resolveRole(pubkey)
    return { pubkey, role, method: 'nip98' }
  } catch (error) {
    throw new AuthenticationError('Invalid NIP-98 authentication', {
      details: error instanceof Error ? error.message : 'Invalid Nostr auth'
    })
  }
}

async function authenticateJwt(request: Request): Promise<AuthResult> {
  const config = getConfig()

  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new AuthenticationError('JWT authentication is not configured')
  }

  let result: JwtValidationResult
  try {
    result = await validateJwtFromRequest(request, config.jwt.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    })
  } catch (error) {
    throw new AuthenticationError('Invalid or expired JWT', {
      details: error instanceof Error ? error.message : 'Invalid token'
    })
  }
  return resolveJwtAuth(result.payload)
}

/**
 * Turns an already signature-verified session or device JWT payload into an
 * {@link AuthResult}. Shared by {@link authenticate} and the SSE stream so
 * both apply the same token-type, instance-binding and role rules.
 *
 * @throws {AuthenticationError} For a token type that is not an API
 *   credential, a missing pubkey, or a device token bound to another instance.
 * @throws {ApiError} 503 when the role cannot be resolved.
 */
export async function resolveJwtAuth(
  payload: JwtValidationResult['payload']
): Promise<AuthResult> {
  // Only session JWTs (no `kind`) and device tokens are API credentials.
  // Anything else signed with the same secret — merge tickets, link
  // challenges — is a single-purpose token and must never authenticate a
  // request as its `pubkey` claim.
  if (!ACCEPTED_JWT_KINDS.has(payload.kind)) {
    throw new AuthenticationError('Invalid or expired JWT', {
      details: 'Token type is not accepted as an API credential'
    })
  }

  const pubkey = payload.pubkey
  if (!pubkey) {
    throw new AuthenticationError('JWT missing pubkey claim')
  }

  const claimRole = isValidRole(payload.role) ? payload.role : Role.USER
  const isDeviceToken = payload.kind === 'device'

  // Device tokens (B.0) carry an explicit `scopes` claim that narrows what the
  // token can do regardless of role. Only trust a well-formed array of known
  // permission strings; ignore anything malformed so a bad claim can never
  // *widen* access.
  const rawScopes = payload.scopes
  const claimScopes = Array.isArray(rawScopes)
    ? rawScopes.filter(
        (s: unknown): s is Permission =>
          typeof s === 'string' && isValidPermission(s)
      )
    : undefined

  // Device tokens (B.0) are scoped to the instance that minted them. Reject a
  // token whose `apiUrl` claim is missing or doesn't match this platform's URL
  // so a token issued for one instance can't be replayed against another. Only
  // device tokens carry `apiUrl`; session JWTs (no `kind`) are unaffected.
  if (isDeviceToken) {
    // `apiUrl` is the only per-instance discriminator on a device token —
    // `iss`/`aud` are identical on every instance. The comparison must use
    // the configured `endpoint` setting exclusively; `resolveApiUrl` would
    // fall back to the client-supplied `Host` header when `endpoint` is
    // unset, making the binding compare the frozen claim against an
    // attacker-controlled value. To prevent a TOCTOU race where a second
    // read inside `resolveApiUrl` observes a different snapshot (e.g. after
    // an admin removes the endpoint between the two reads), we read and
    // parse `endpoint` exactly once and build the comparison URL directly
    // from that single result. The binding is therefore never driven by an
    // attacker-controllable header.
    const { endpoint } = await getSettings(['endpoint'], { cache: 'hot' })
    const parsed = parseEndpoint(endpoint)
    if (!parsed) {
      throw new AuthenticationError(
        'Device tokens cannot be verified until `endpoint` is configured',
        {
          details: 'Instance endpoint is unset; apiUrl binding is unenforceable'
        }
      )
    }
    const url = `${parsed.protocol}//${parsed.host}`
    if (normalizeApiUrl(payload.apiUrl) !== normalizeApiUrl(url)) {
      throw new AuthenticationError('Token is not valid for this instance', {
        details: 'Device token apiUrl does not match this platform'
      })
    }
  }

  // JWTs are unrevocable, so the baked-in role claim is only a hint:
  // re-resolve it from the DB on every request, exactly like the NIP-98 path.
  // A demoted or deleted account then loses its privileges immediately
  // instead of keeping them until token expiry.
  const currentRole = await resolveRole(pubkey).catch(cause => {
    // The token is already cryptographically valid here, so a failed
    // lookup is an infrastructure problem, not a credential problem.
    // Reporting it as 401 would tell the user their session expired —
    // a re-login can't fix a DB outage, and it buckets the incident
    // under auth failures instead of availability.
    throw new ApiError('Could not resolve account role', {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      cause
    })
  })

  if (!isDeviceToken) {
    return { pubkey, role: currentRole, method: 'jwt', scopes: claimScopes }
  }

  // A device token's `scopes` are what the minting admin delegated (validated
  // against *their* RBAC at mint time), so they stand as claimed. Its role,
  // though, is never more than the owner holds today — the lower of the
  // minted claim and the current DB role — so a demoted owner's token cannot
  // carry the old role into anything that reads `auth.role`. A token with no
  // usable `scopes` claim gets an empty set, never the role's full map.
  const role = hasRole(currentRole, claimRole) ? claimRole : currentRole
  return {
    pubkey,
    role,
    method: 'jwt',
    scopes: claimScopes ?? [],
    deviceToken: true
  }
}

/**
 * Authenticates and verifies the actor satisfies the role hierarchy.
 *
 * Device tokens are always refused here: a role gate says nothing about which
 * of the role's permissions the token was delegated, so honouring it would
 * let a narrowly-scoped token reach everything its owner's role can.
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
 * Scope-aware permission check on an already-authenticated result. A device
 * token's `scopes` claim is authoritative — it's the explicit set the admin
 * delegated, already validated as a subset of their RBAC at mint time. For
 * every other caller, falls back to the role→permission map.
 *
 * Routes that call {@link authenticate} directly MUST use this instead of a
 * bare `hasPermission(auth.role, …)`, or a narrowly-scoped device token
 * silently inherits its owner's full role (privilege escalation).
 */
export function authHasPermission(
  auth: AuthResult,
  permission: Permission
): boolean {
  return auth.scopes
    ? auth.scopes.includes(permission)
    : hasPermission(auth.role, permission)
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
  const auth = await authenticate(request, { allowDeviceToken: true })

  if (!authHasPermission(auth, permission)) {
    throw new AuthorizationError('Not authorized to perform this action')
  }

  return auth
}
