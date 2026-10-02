import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { ValidationError } from '@/types/server/errors'
import { OAUTH_GRANT_TYPES } from '@/lib/oauth/constants'
import type { OAuthErrorCode } from '@/lib/oauth/protocol'

const DEFAULT_CLIENT_NAME = 'MCP client'
const CLIENT_NAME_MAX_CHARS = 100
const UNUSED_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PENDING_GRANT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The consent screen shows this name, and anyone can register one: strip
 * control, format (bidi overrides, zero-width) and line-separator characters
 * so it cannot be laid out to imitate something else.
 */
export function normalizeClientName(name: string | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .trim()
  return (
    Array.from(cleaned).slice(0, CLIENT_NAME_MAX_CHARS).join('').trim() ||
    DEFAULT_CLIENT_NAME
  )
}

/** RFC 7591 §3.2.2: which error code a rejected registration gets. */
export function registrationErrorCode(error: ValidationError): OAuthErrorCode {
  const issue = Array.isArray(error.details)
    ? (error.details[0] as { path?: unknown[] } | undefined)
    : undefined
  return issue?.path?.[0] === 'redirect_uris'
    ? 'invalid_redirect_uri'
    : 'invalid_client_metadata'
}

/**
 * Registers a public client. Whatever the request asked for (a secret-based
 * auth method, other grant types), the response states what was registered.
 */
export async function registerClient(input: {
  redirect_uris: string[]
  client_name?: string
}) {
  const client = await prisma.oAuthClient.create({
    data: {
      name: normalizeClientName(input.client_name),
      redirectUris: [...new Set(input.redirect_uris)]
    }
  })
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: 'none' as const,
    grant_types: [...OAUTH_GRANT_TYPES],
    response_types: ['code' as const]
  }
}

/**
 * Bounded housekeeping, run on each registration instead of a cron. Claude
 * registers a new client for every fresh connection, so abandoned ones pile
 * up; a client with any grant is never touched — ChatGPT reuses one client
 * per connector, and revoked grants anchor the MCP payment ledger.
 * Best-effort: a failure here must not block the registration.
 */
export async function pruneStaleOAuthRecords(now = new Date()): Promise<void> {
  try {
    await prisma.oAuthClient.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - UNUSED_CLIENT_TTL_MS) },
        grants: { none: {} }
      }
    })
    // Consent given but the code never exchanged: no token, no payment.
    await prisma.oAuthGrant.deleteMany({
      where: {
        codeUsedAt: null,
        codeExpiresAt: { lt: new Date(now.getTime() - PENDING_GRANT_TTL_MS) }
      }
    })
  } catch (err) {
    logger.warn({ err }, 'oauth.prune_failed')
  }
}
