import { prisma } from '@/lib/prisma'
import {
  isAllowedOAuthRedirectUri,
  isLoopbackRedirect,
  type OAuthAuthorizeRequest
} from '@/lib/validation/schemas'
import {
  OAUTH_SCOPES,
  isOAuthScope,
  mcpResourceUrl,
  withImpliedScopes,
  type OAuthScope
} from '@/lib/oauth/constants'
import { OAuthError } from '@/lib/oauth/protocol'

/** An authorization request that passed every check against this instance. */
export interface ValidatedAuthorization {
  client: { id: string; name: string }
  /** Where the OAuth response goes; also stored with the code. */
  redirectUri: string
  /** Scopes the consent screen may offer. */
  scopes: OAuthScope[]
  /** Canonical resource the grant is bound to. */
  resource: string
  codeChallenge: string
  state?: string
}

/**
 * Exact string match, except that a loopback `http:` URI matches on any
 * port: native apps (Claude Code, the MCP Inspector, Cursor) listen on
 * whatever port is free at login time (RFC 8252 §7.3).
 */
export function redirectUriMatches(
  requested: string,
  registered: string
): boolean {
  if (requested === registered) return true
  if (!isAllowedOAuthRedirectUri(requested)) return false
  const a = new URL(requested)
  const b = new URL(registered)
  return (
    isLoopbackRedirect(a) &&
    isLoopbackRedirect(b) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search
  )
}

/**
 * Where the consent screen says the browser will land. The client names
 * itself, so the destination is what the user can actually trust. Empty for a
 * host-less native scheme (`com.example.app:/cb`): the page then shows the
 * whole URI.
 */
export function redirectHost(redirectUri: string): string {
  const { protocol, host } = new URL(redirectUri)
  if (protocol === 'https:' || protocol === 'http:') return host
  return host && `${protocol}//${host}`
}

/** Appends the OAuth response to the redirect URI, keeping its own query. */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | undefined>
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Lowercase scheme and host, no trailing slash; null for anything unusable. */
function normalizeResource(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.search || url.username || url.password || value.includes('#')) {
      return null
    }
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/**
 * RFC 8707: a `resource` names either the MCP URL a grant is bound to or
 * that instance's bare origin — clients that fall back to the root metadata
 * document may send the latter.
 */
export function resourceMatches(value: string, resource: string): boolean {
  const normalized = normalizeResource(value)
  return (
    normalized !== null &&
    (normalized === normalizeResource(resource) ||
      normalized === new URL(resource).origin)
  )
}

/**
 * Scopes to offer: the requested ones we know, else all of them (a client
 * asking only for scopes we do not have still gets a meaningful screen).
 */
export function offeredScopes(scope?: string): OAuthScope[] {
  const requested = (scope ?? '').split(' ').filter(isOAuthScope)
  return withImpliedScopes(requested.length ? requested : OAUTH_SCOPES)
}

/**
 * Checks an authorization request against this instance: a registered client,
 * one of its redirect URIs, the code flow and our MCP resource. PKCE shape is
 * already enforced by the schema.
 *
 * @throws {OAuthError} Callers pick how to answer it — RFC shape for the
 *   public validation endpoint, the app envelope for the consent POST.
 */
export async function validateAuthorizationRequest(
  params: OAuthAuthorizeRequest,
  apiUrl: string
): Promise<ValidatedAuthorization> {
  const client = await prisma.oAuthClient.findUnique({
    where: { id: params.client_id },
    select: { id: true, name: true, redirectUris: true }
  })
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id')

  if (
    !client.redirectUris.some(registered =>
      redirectUriMatches(params.redirect_uri, registered)
    )
  ) {
    throw new OAuthError(
      'invalid_request',
      'redirect_uri is not registered for this client'
    )
  }

  if (params.response_type !== 'code') {
    throw new OAuthError(
      'unsupported_response_type',
      'Only response_type=code is supported'
    )
  }

  const resource = mcpResourceUrl(apiUrl)
  if (params.resource && !resourceMatches(params.resource, resource)) {
    throw new OAuthError(
      'invalid_target',
      `resource must be this instance's MCP endpoint (${resource})`
    )
  }

  return {
    client: { id: client.id, name: client.name },
    redirectUri: params.redirect_uri,
    scopes: offeredScopes(params.scope),
    resource,
    codeChallenge: params.code_challenge,
    state: params.state || undefined
  }
}
