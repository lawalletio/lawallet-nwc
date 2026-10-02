import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { authenticate, type AuthResult } from '@/lib/auth/unified-auth'
import {
  AuthorizationError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import type { OAuthGrantSummary } from '@/lib/validation/schemas'
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_PREFIX,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  isOAuthScope,
  withImpliedScopes,
  type OAuthScope
} from '@/lib/oauth/constants'
import { resourceMatches } from '@/lib/oauth/authorize'
import { OAuthError } from '@/lib/oauth/protocol'

// ── Credentials ─────────────────────────────────────────────────────────────
// Codes and tokens are 256-bit random values. Only their SHA-256 is stored, so
// a database read never yields a usable credential.

export function generateCredential(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

export function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

/** RFC 7636 S256, compared in constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(
    createHash('sha256').update(verifier).digest('base64url')
  )
  const expected = Buffer.from(challenge)
  return (
    computed.length === expected.length && timingSafeEqual(computed, expected)
  )
}

// ── Consent ─────────────────────────────────────────────────────────────────

/**
 * Grant management needs the account's full authority. A device token is
 * narrowed by design (`scopes`), so it must not mint or manage a broader
 * credential.
 *
 * @throws {AuthorizationError} For a device token.
 */
export async function authenticateSession(
  request: Request
): Promise<AuthResult> {
  const auth = await authenticate(request)
  if (auth.scopes) {
    throw new AuthorizationError(
      'Device tokens cannot manage OAuth authorizations'
    )
  }
  return auth
}

/**
 * The scopes and budget the user approved: a non-empty subset of what the
 * consent screen offered, plus implied scopes. `spend` always carries a
 * budget; without it the budget is null.
 *
 * @throws {ValidationError} When the selection breaks one of those rules.
 */
export function resolveApproval(
  selected: OAuthScope[] | undefined,
  spendLimitSats: number | null | undefined,
  offered: OAuthScope[]
): { scopes: OAuthScope[]; spendLimitSats: number | null } {
  if (!selected?.length) {
    throw new ValidationError('Select at least one permission to approve')
  }
  if (!selected.every(scope => offered.includes(scope))) {
    throw new ValidationError('The client did not request that permission')
  }
  const scopes = withImpliedScopes(selected)
  if (!scopes.includes('spend')) return { scopes, spendLimitSats: null }
  if (!spendLimitSats) {
    throw new ValidationError('Sending payments requires a daily limit')
  }
  return { scopes, spendLimitSats }
}

/**
 * Records an approval as a grant holding a single-use authorization code.
 * The account's earlier grant for the same client is replaced only once this
 * code is exchanged (see {@link exchangeAuthorizationCode}), so an abandoned
 * reconnect never leaves the user disconnected.
 *
 * @returns The authorization code — shown once, never stored in clear.
 */
export async function createAuthorizationGrant(input: {
  userId: string
  client: { id: string; name: string }
  redirectUri: string
  codeChallenge: string
  resource: string
  scopes: OAuthScope[]
  spendLimitSats: number | null
}): Promise<string> {
  const code = generateCredential(AUTH_CODE_PREFIX)
  const now = new Date()
  const grant = await prisma.oAuthGrant.create({
    data: {
      clientId: input.client.id,
      userId: input.userId,
      scopes: input.scopes,
      resource: input.resource,
      spendLimitSats: input.spendLimitSats,
      codeHash: hashCredential(code),
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      codeExpiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000)
    },
    select: { id: true }
  })

  const spend = input.scopes.includes('spend')
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.OAUTH_GRANT_CREATED,
    level: spend ? 'WARN' : 'INFO',
    message: `Authorized "${input.client.name}" (${input.scopes.join(', ')}${
      spend ? `, up to ${input.spendLimitSats} sats per 24h` : ''
    })`,
    userId: input.userId,
    metadata: {
      grantId: grant.id,
      clientId: input.client.id,
      clientName: input.client.name,
      scopes: input.scopes,
      spendLimitSats: input.spendLimitSats
    }
  })

  return code
}

// ── Token endpoint ──────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

const GRANT_LOG_SELECT = {
  id: true,
  userId: true,
  clientId: true,
  scopes: true,
  client: { select: { name: true } }
} as const

type GrantForLog = {
  id: string
  userId: string
  clientId: string
  scopes: string[]
  client: { name: string }
}

/**
 * Revokes a grant; its tokens and code stop working at once. The row stays
 * for the MCP payment ledger. Idempotent — only the first revocation logs.
 */
async function revokeGrant(
  grant: GrantForLog,
  reason: 'user' | 'client' | 'code_replay'
): Promise<void> {
  const { count } = await prisma.oAuthGrant.updateMany({
    where: { id: grant.id, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  if (count === 0) return

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.OAUTH_GRANT_REVOKED,
    level:
      reason === 'code_replay' || grant.scopes.includes('spend')
        ? 'WARN'
        : 'INFO',
    message:
      reason === 'code_replay'
        ? `Revoked "${grant.client.name}": its authorization code was used twice`
        : `Revoked "${grant.client.name}"`,
    userId: grant.userId,
    metadata: {
      grantId: grant.id,
      clientId: grant.clientId,
      clientName: grant.client.name,
      reason
    }
  })
}

async function requireClient(clientId: string): Promise<void> {
  const client = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { id: true }
  })
  // `invalid_client` makes MCP clients register again instead of looping.
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id')
}

function invalidGrant(message: string): OAuthError {
  return new OAuthError('invalid_grant', message)
}

function invalidTarget(resource: string): OAuthError {
  return new OAuthError(
    'invalid_target',
    `resource must be the MCP endpoint this grant is for (${resource})`
  )
}

/** A fresh access/refresh pair and the columns that store it. */
function rotateTokens(now: Date, scopes: string[]) {
  const accessToken = generateCredential(ACCESS_TOKEN_PREFIX)
  const refreshToken = generateCredential(REFRESH_TOKEN_PREFIX)
  return {
    data: {
      accessTokenHash: hashCredential(accessToken),
      accessExpiresAt: new Date(
        now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000
      ),
      refreshTokenHash: hashCredential(refreshToken),
      // Sliding window: every refresh restarts it.
      refreshExpiresAt: new Date(
        now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000
      )
    },
    response: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' ')
    } satisfies TokenResponse
  }
}

/**
 * `grant_type=authorization_code`. The code is single use: it is consumed
 * with a conditional update, so of two concurrent exchanges exactly one wins,
 * and presenting a used code revokes the grant (RFC 6749 §4.1.2 — the code
 * has leaked).
 *
 * @throws {OAuthError} `invalid_client`, `invalid_grant` or `invalid_target`.
 */
export async function exchangeAuthorizationCode(params: {
  code: string
  redirect_uri: string
  client_id: string
  code_verifier: string
  resource?: string
}): Promise<TokenResponse> {
  await requireClient(params.client_id)

  const grant = await prisma.oAuthGrant.findUnique({
    where: { codeHash: hashCredential(params.code) },
    select: {
      ...GRANT_LOG_SELECT,
      resource: true,
      codeChallenge: true,
      redirectUri: true,
      codeExpiresAt: true,
      codeUsedAt: true,
      revokedAt: true
    }
  })
  if (!grant || grant.revokedAt) {
    throw invalidGrant('Invalid or revoked authorization code')
  }
  if (grant.codeUsedAt) {
    await revokeGrant(grant, 'code_replay')
    throw invalidGrant('Authorization code was already used')
  }
  if (grant.clientId !== params.client_id) {
    throw invalidGrant('Authorization code was issued to another client')
  }
  const now = new Date()
  if (!grant.codeExpiresAt || grant.codeExpiresAt <= now) {
    throw invalidGrant('Authorization code expired')
  }
  if (grant.redirectUri !== params.redirect_uri) {
    throw invalidGrant('redirect_uri does not match the authorization request')
  }
  if (
    !grant.codeChallenge ||
    !pkceMatches(params.code_verifier, grant.codeChallenge)
  ) {
    throw invalidGrant('code_verifier does not match the code_challenge')
  }
  if (params.resource && !resourceMatches(params.resource, grant.resource)) {
    throw invalidTarget(grant.resource)
  }

  const tokens = rotateTokens(now, grant.scopes)
  const { count } = await prisma.oAuthGrant.updateMany({
    where: { id: grant.id, codeUsedAt: null, revokedAt: null },
    data: { codeUsedAt: now, ...tokens.data }
  })
  if (count !== 1) {
    // A concurrent exchange of the same code won the race: this is a replay.
    await revokeGrant(grant, 'code_replay')
    throw invalidGrant('Authorization code was already used')
  }
  await replaceEarlierGrants(grant, now)
  return tokens.response
}

/**
 * A reconnect takes effect when its code is exchanged: the account's other
 * grants for the same client stop working then, not when consent was given.
 */
async function replaceEarlierGrants(grant: GrantForLog, now: Date) {
  const { count } = await prisma.oAuthGrant.updateMany({
    where: {
      userId: grant.userId,
      clientId: grant.clientId,
      revokedAt: null,
      id: { not: grant.id }
    },
    data: { revokedAt: now }
  })
  if (count === 0) return
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.OAUTH_GRANT_REVOKED,
    message: `Replaced ${count} earlier authorization of "${grant.client.name}"`,
    userId: grant.userId,
    metadata: {
      grantId: grant.id,
      clientId: grant.clientId,
      clientName: grant.client.name,
      reason: 'replaced',
      replacedGrants: count
    }
  })
}

/**
 * `grant_type=refresh_token`. Rotates both tokens with an update keyed on the
 * presented refresh token, so each one works exactly once even under
 * concurrency; the old access token stops working too.
 *
 * ponytail: no grace window for a lost refresh response — the client must
 * re-authorize. Keep the previous refresh hash for a few seconds if a client
 * turns out to race its own refreshes.
 *
 * @throws {OAuthError} `invalid_client`, `invalid_grant` or `invalid_target`.
 */
export async function refreshAccessToken(params: {
  refresh_token: string
  client_id: string
  resource?: string
}): Promise<TokenResponse> {
  await requireClient(params.client_id)

  const refreshTokenHash = hashCredential(params.refresh_token)
  const grant = await prisma.oAuthGrant.findUnique({
    where: { refreshTokenHash },
    select: {
      clientId: true,
      id: true,
      scopes: true,
      resource: true,
      refreshExpiresAt: true,
      revokedAt: true
    }
  })
  const now = new Date()
  if (
    !grant ||
    grant.revokedAt ||
    !grant.refreshExpiresAt ||
    grant.refreshExpiresAt <= now
  ) {
    throw invalidGrant('Invalid, expired or revoked refresh token')
  }
  if (grant.clientId !== params.client_id) {
    throw invalidGrant('Refresh token was issued to another client')
  }
  if (params.resource && !resourceMatches(params.resource, grant.resource)) {
    throw invalidTarget(grant.resource)
  }

  const tokens = rotateTokens(now, grant.scopes)
  const { count } = await prisma.oAuthGrant.updateMany({
    where: { id: grant.id, refreshTokenHash, revokedAt: null },
    data: tokens.data
  })
  if (count !== 1) throw invalidGrant('Refresh token was already used')
  return tokens.response
}

/**
 * RFC 7009: revokes the grant an access or refresh token belongs to. Unknown
 * tokens are silently ignored — the answer is the same either way.
 */
export async function revokeToken(token: string): Promise<void> {
  const hash = hashCredential(token)
  const grant = await prisma.oAuthGrant.findFirst({
    where: { OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }] },
    select: GRANT_LOG_SELECT
  })
  if (grant) await revokeGrant(grant, 'client')
}

// ── Connected apps ──────────────────────────────────────────────────────────

/** The account's working grants (code exchanged, not revoked, not expired). */
export async function listActiveGrants(
  userId: string
): Promise<OAuthGrantSummary[]> {
  const grants = await prisma.oAuthGrant.findMany({
    where: {
      userId,
      codeUsedAt: { not: null },
      revokedAt: null,
      refreshExpiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' },
    // A bound, not pagination: every row is an app the user connected.
    take: 100,
    select: {
      id: true,
      scopes: true,
      spendLimitSats: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { name: true } }
    }
  })
  return grants.map(grant => ({
    id: grant.id,
    clientName: grant.client.name,
    scopes: grant.scopes.filter(isOAuthScope),
    spendLimitSats: grant.spendLimitSats,
    createdAt: grant.createdAt.toISOString(),
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null
  }))
}

/**
 * Revokes one of the account's grants.
 *
 * @throws {NotFoundError} When the grant is not the account's — never a 403,
 *   which would confirm that the id exists.
 */
export async function revokeUserGrant(
  grantId: string,
  userId: string
): Promise<void> {
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id: grantId, userId },
    select: GRANT_LOG_SELECT
  })
  if (!grant) throw new NotFoundError('Authorization not found')
  await revokeGrant(grant, 'user')
}
