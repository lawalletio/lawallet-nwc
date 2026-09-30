import {
  OAUTH_GRANT_TYPES,
  OAUTH_SCOPES,
  mcpResourceUrl
} from '@/lib/oauth/constants'

/**
 * Discovery documents change only when the `endpoint` setting does, and MCP
 * hosts fetch them on every connection: a short public cache is safe.
 */
export const METADATA_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300'
} as const

/**
 * RFC 8414 authorization server metadata. The issuer is the instance URL,
 * byte-identical to `authorization_servers[0]` in the resource metadata —
 * clients reject a mismatch.
 *
 * Dynamic registration only. ponytail: no CIMD (client ID metadata
 * documents) — DCR is deprecated as of MCP 2026-07-28 but every current
 * client still falls back to it. Advertising
 * `client_id_metadata_document_supported` means fetching client-supplied
 * URLs, so it needs an SSRF-guarded fetch and a cache first.
 */
export function authorizationServerMetadata(apiUrl: string) {
  return {
    issuer: apiUrl,
    authorization_endpoint: `${apiUrl}/oauth/authorize`,
    token_endpoint: `${apiUrl}/api/oauth/token`,
    registration_endpoint: `${apiUrl}/api/oauth/register`,
    revocation_endpoint: `${apiUrl}/api/oauth/revoke`,
    // Deliberately no `offline_access` or OpenID scopes: clients would request
    // them, and refresh tokens are issued without being asked.
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [...OAUTH_GRANT_TYPES],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    // RFC 9207: every authorization response, success or error, carries `iss`.
    authorization_response_iss_parameter_supported: true
  }
}

/**
 * RFC 9728 protected resource metadata for the MCP endpoint. Served at both
 * the path-suffixed and the root well-known URL with the same `resource`:
 * clients require it to equal the MCP URL they were given.
 */
export function protectedResourceMetadata(apiUrl: string) {
  return {
    resource: mcpResourceUrl(apiUrl),
    authorization_servers: [apiUrl],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header']
  }
}
