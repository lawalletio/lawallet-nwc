import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { AuthenticationError } from '@/types/server/errors'
import {
  ACCESS_TOKEN_PREFIX,
  isOAuthScope,
  type OAuthScope
} from '@/lib/oauth/constants'
import { hashCredential } from '@/lib/oauth/grants'

/** What a valid OAuth access token proves about the caller. */
export interface OAuthAccessContext {
  grantId: string
  clientId: string
  clientName: string
  /** Account (User.id) that authorized the client. */
  userId: string
  /** Primary pubkey of that account. */
  pubkey: string
  scopes: OAuthScope[]
  /** Rolling-24h spend budget in sats; null unless `spend` was granted. */
  spendLimitSats: number | null
}

/** `lastUsedAt` is informational: one write a minute per grant is plenty. */
const LAST_USED_RESOLUTION_MS = 60_000

/** Fire-and-forget; the condition keeps concurrent requests to one write. */
async function touchLastUsed(grantId: string, now: Date): Promise<void> {
  try {
    await prisma.oAuthGrant.updateMany({
      where: {
        id: grantId,
        OR: [
          { lastUsedAt: null },
          {
            lastUsedAt: {
              lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS)
            }
          }
        ]
      },
      data: { lastUsedAt: now }
    })
  } catch (err) {
    logger.warn({ err }, 'oauth.last_used_update_failed')
  }
}

/** Cheap shape check — true for tokens minted by the OAuth token endpoint. */
export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX)
}

/**
 * Resolves an OAuth access token to the grant behind it.
 *
 * @param token - The bearer token exactly as presented.
 * @param resource - Canonical resource URL of the endpoint being called
 *   (`mcpResourceUrl(apiUrl)`); the token must have been issued for it.
 * @throws {AuthenticationError} When the token is unknown, expired, revoked,
 *   or was issued for a different resource.
 */
export async function verifyAccessToken(
  token: string,
  resource: string
): Promise<OAuthAccessContext> {
  const grant = isOAuthAccessToken(token)
    ? await prisma.oAuthGrant.findUnique({
        where: { accessTokenHash: hashCredential(token) },
        select: {
          id: true,
          clientId: true,
          userId: true,
          scopes: true,
          spendLimitSats: true,
          resource: true,
          accessExpiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          client: { select: { name: true } },
          user: { select: { pubkey: true } }
        }
      })
    : null
  if (!grant) throw new AuthenticationError('Unknown access token')
  if (grant.revokedAt) {
    throw new AuthenticationError('Access token has been revoked')
  }
  const now = new Date()
  if (!grant.accessExpiresAt || grant.accessExpiresAt <= now) {
    throw new AuthenticationError('Access token has expired')
  }
  if (grant.resource !== resource) {
    throw new AuthenticationError(
      'Access token was issued for a different resource'
    )
  }

  if (
    !grant.lastUsedAt ||
    now.getTime() - grant.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS
  ) {
    void touchLastUsed(grant.id, now)
  }

  const scopes = grant.scopes.filter(isOAuthScope)
  return {
    grantId: grant.id,
    clientId: grant.clientId,
    clientName: grant.client.name,
    userId: grant.userId,
    pubkey: grant.user.pubkey,
    scopes,
    spendLimitSats: scopes.includes('spend') ? grant.spendLimitSats : null
  }
}
