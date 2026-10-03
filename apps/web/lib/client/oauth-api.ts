import type { ApiClient } from '@/lib/client/api-client'
import type { OAuthScope } from '@/lib/oauth/constants'

export const AUTHORIZE_PATH = '/api/oauth/authorize'
export const GRANTS_PATH = '/api/oauth/grants'

/** `GET /api/oauth/authorize` — an authorization request the server accepted. */
export interface AuthorizeRequestDetails {
  client: { id: string; name: string }
  redirectUri: string
  redirectHost: string
  scopes: OAuthScope[]
  resource: string
  defaultSpendLimitSats: number
  maxSpendLimitSats: number
}

/** One row of `GET /api/oauth/grants`. */
export interface OAuthGrantSummary {
  id: string
  clientName: string
  scopes: OAuthScope[]
  spendLimitSats: number | null
  createdAt: string
  lastUsedAt: string | null
}

export type AuthorizeRequestCheck =
  | { ok: true; details: AuthorizeRequestDetails }
  | { ok: false; error: string | null; description: string }

/**
 * Validates the consent page's query string. Plain fetch rather than
 * `apiClient`: the endpoint is public and answers errors in RFC 6749 shape
 * (`{ error, error_description }`), which `apiClient` would flatten into
 * "Request failed (400)".
 */
export async function checkAuthorizeRequest(
  query: string
): Promise<AuthorizeRequestCheck> {
  let response: Response
  try {
    response = await fetch(`${AUTHORIZE_PATH}?${query}`, { cache: 'no-store' })
  } catch {
    return {
      ok: false,
      error: null,
      description:
        'Could not reach this LaWallet instance. Check your connection and reload the page.'
    }
  }

  const body = await response.json().catch(() => null)
  if (response.ok && body) {
    return { ok: true, details: body as AuthorizeRequestDetails }
  }
  return {
    ok: false,
    error: typeof body?.error === 'string' ? body.error : null,
    description:
      typeof body?.error_description === 'string'
        ? body.error_description
        : `This request could not be verified (HTTP ${response.status}).`
  }
}

const OAUTH_PARAMS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'state',
  'resource'
] as const

/**
 * `POST /api/oauth/authorize` — records the user's decision and returns where
 * to send the browser. The OAuth params are forwarded exactly as the client
 * sent them; absent ones are omitted rather than sent as null.
 */
export function submitAuthorizeDecision(
  apiClient: ApiClient,
  search: URLSearchParams,
  decision: { approve: boolean; scopes: OAuthScope[]; spendLimitSats?: number }
) {
  const params: Record<string, string> = {}
  for (const key of OAUTH_PARAMS) {
    const value = search.get(key)
    if (value !== null) params[key] = value
  }
  return apiClient.post<{ redirectTo: string }>(AUTHORIZE_PATH, {
    ...params,
    ...decision
  })
}
