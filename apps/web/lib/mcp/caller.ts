import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getRolePermissions, type Role } from '@/lib/auth/permissions'
import { createJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { resolveApiUrl } from '@/lib/public-url'
import { isOAuthAccessToken, verifyAccessToken } from '@/lib/oauth/access-token'
import {
  MCP_PATH,
  mcpResourceUrl,
  type OAuthScope
} from '@/lib/oauth/constants'
import { AuthenticationError, InternalServerError } from '@/types/server/errors'
import type { McpCaller } from '@/lib/mcp/types'

/** Session JWTs predate MCP scopes: they read and write, never spend. */
const JWT_SCOPES: ReadonlySet<OAuthScope> = new Set(['read', 'write'])

/**
 * Lifetime of the session JWT minted for an OAuth caller. It only has to
 * outlive one MCP request (capped at 60s) and never leaves the process.
 */
const INTERNAL_TOKEN_TTL_SECONDS = 60

/** Missing or rejected credentials on the authenticated endpoint → HTTP 401. */
export class McpAuthError extends Error {
  constructor(
    /** `invalid_token` when a credential was presented but rejected. */
    readonly code: 'invalid_token' | 'unauthorized',
    message: string,
    readonly apiUrl: string
  ) {
    super(message)
    this.name = 'McpAuthError'
  }
}

/**
 * The 401 that starts (or restarts) the OAuth flow: `resource_metadata` points
 * clients at the protected-resource metadata. No `scope` parameter on purpose:
 * clients then request every supported scope and the consent screen decides.
 */
export function unauthorizedResponse(error: McpAuthError): Response {
  let challenge = `Bearer resource_metadata="${error.apiUrl}/.well-known/oauth-protected-resource${MCP_PATH}"`
  if (error.code === 'invalid_token') challenge += ', error="invalid_token"'
  return NextResponse.json(
    { error: error.code, error_description: error.message },
    { status: 401, headers: { 'WWW-Authenticate': challenge } }
  )
}

/** Caller of the public endpoint: always anonymous, whatever it presents. */
export async function resolvePublicCaller(
  request: Request
): Promise<McpCaller> {
  return {
    user: null,
    scopes: new Set(),
    grant: null,
    authorization: null,
    apiUrl: await resolveApiUrl(request),
    request
  }
}

/**
 * Resolves the caller of the authenticated endpoint from its `Bearer` token:
 * an OAuth access token issued by this instance, or a session JWT (device
 * tokens are refused).
 *
 * @throws {McpAuthError} When the credential is missing or rejected.
 */
export async function resolveCaller(request: Request): Promise<McpCaller> {
  const apiUrl = await resolveApiUrl(request)
  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    throw new McpAuthError(
      'unauthorized',
      header
        ? 'Only Bearer tokens are accepted here'
        : 'Authorization required',
      apiUrl
    )
  }

  try {
    return isOAuthAccessToken(token)
      ? await oauthCaller(token, request, apiUrl)
      : await jwtCaller(request, apiUrl)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw new McpAuthError('invalid_token', error.message, apiUrl)
    }
    throw error
  }
}

async function oauthCaller(
  token: string,
  request: Request,
  apiUrl: string
): Promise<McpCaller> {
  const grant = await verifyAccessToken(token, mcpResourceUrl(apiUrl))
  // Re-resolved per request, like a session: a demoted account loses its
  // privileges immediately instead of when the token expires.
  const role = await resolveRole(grant.pubkey)
  return {
    user: { pubkey: grant.pubkey, userId: grant.userId, role },
    scopes: new Set(grant.scopes),
    grant: {
      id: grant.grantId,
      clientName: grant.clientName,
      spendLimitSats: grant.spendLimitSats
    },
    authorization: `Bearer ${internalSessionToken(grant.userId, grant.pubkey, role)}`,
    apiUrl,
    request
  }
}

async function jwtCaller(request: Request, apiUrl: string): Promise<McpCaller> {
  const auth = await authenticate(request)
  // A device token is narrowed to a few permissions for one device. The
  // wallet tools never consult those permissions, so on this endpoint it would
  // read balances and mint invoices it cannot touch over REST.
  if (auth.scopes) {
    throw new AuthenticationError(
      'Device tokens cannot be used here; connect through OAuth or use a session token'
    )
  }
  const account = await resolveAccountByPubkey(auth.pubkey)
  return {
    user: {
      pubkey: account?.primaryPubkey ?? auth.pubkey,
      userId: account?.id ?? null,
      role: auth.role
    },
    scopes: JWT_SCOPES,
    grant: null,
    authorization: request.headers.get('authorization'),
    apiUrl,
    request
  }
}

/**
 * A session JWT for the grant's account, minted as `POST /api/jwt` does, so
 * REST handlers dispatched in-process authenticate an OAuth caller like any
 * signed-in session (and re-resolve its role from the database).
 *
 * It also carries a `scopes` claim equal to the role's own permissions: REST
 * checks the same permission set, but the OAuth consent and grant endpoints
 * refuse any token with `scopes`, so a `write` client can never approve itself
 * a broader grant — a second guard behind the `/api/oauth` path exclusion.
 */
function internalSessionToken(
  userId: string,
  pubkey: string,
  role: Role
): string {
  const { jwt } = getConfig()
  if (!jwt.enabled || !jwt.secret) {
    throw new InternalServerError('JWT authentication is not configured')
  }
  const permissions = getRolePermissions(role)
  return createJwtToken(
    {
      userId,
      pubkey,
      authPubkey: pubkey,
      role,
      permissions,
      scopes: permissions
    },
    jwt.secret,
    {
      expiresIn: INTERNAL_TOKEN_TTL_SECONDS,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }
  )
}
