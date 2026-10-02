/**
 * OAuth scopes an MCP client can be granted. They gate MCP tools only — REST
 * authorization (roles, permissions, ownership) still applies underneath.
 *
 *  - `read`  — read-only tools.
 *  - `write` — tools that create or change data, including minting invoices.
 *  - `spend` — sending payments from the account's wallets, inside the grant's
 *              daily budget. Opt-in on the consent screen, never a default.
 */
export const OAUTH_SCOPES = ['read', 'write', 'spend'] as const

export type OAuthScope = (typeof OAUTH_SCOPES)[number]

export function isOAuthScope(value: string): value is OAuthScope {
  return (OAUTH_SCOPES as readonly string[]).includes(value)
}

/** Scopes pre-selected on the consent screen. */
export const DEFAULT_OAUTH_SCOPES: OAuthScope[] = ['read', 'write']

/**
 * Adds the scopes the given ones imply — `write` and `spend` both imply
 * `read`, `spend` does not imply `write` — in canonical order. Scope checks
 * elsewhere can then stay plain membership tests.
 */
export function withImpliedScopes(scopes: Iterable<OAuthScope>): OAuthScope[] {
  const granted = new Set(scopes)
  if (granted.has('write') || granted.has('spend')) granted.add('read')
  return OAUTH_SCOPES.filter(scope => granted.has(scope))
}

/** Grant types the token endpoint serves. */
export const OAUTH_GRANT_TYPES = [
  'authorization_code',
  'refresh_token'
] as const

/** Authenticated MCP endpoint — the OAuth protected resource. */
export const MCP_PATH = '/api/mcp'

/** Unauthenticated MCP endpoint exposing only public, read-only tools. */
export const MCP_PUBLIC_PATH = '/api/mcp/public'

/**
 * RFC 8707 resource identifier of an instance's MCP endpoint. Tokens are bound
 * to it, so a token issued by one instance is useless against another.
 *
 * @param apiUrl - Instance base URL without a trailing slash (`resolveApiUrl`).
 */
export function mcpResourceUrl(apiUrl: string): string {
  return `${apiUrl}${MCP_PATH}`
}

export const AUTH_CODE_TTL_SECONDS = 5 * 60
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
/** Sliding: every refresh rotates the token and restarts this window. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

// Prefixes make the credential kind obvious in logs and to secret scanners,
// and let the MCP endpoint tell an OAuth token from a session JWT at a glance.
export const AUTH_CODE_PREFIX = 'lwac_'
export const ACCESS_TOKEN_PREFIX = 'lwat_'
export const REFRESH_TOKEN_PREFIX = 'lwrt_'

/** Rolling-24h spend budget offered by default when `spend` is granted. */
export const DEFAULT_SPEND_LIMIT_SATS = 10_000
export const MAX_SPEND_LIMIT_SATS = 10_000_000
