import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { toCredentialSummary } from '@/lib/auth/passkey'
import { decryptNsec, isVaultConfigured } from '@/lib/auth/key-vault'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { logger } from '@/lib/logger'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { JsonParseError, validateBody } from '@/lib/validation/middleware'
import { accountDeleteRequestSchema } from '@/lib/validation/schemas'
import { deleteAccount } from '@/lib/account/delete'
import { eventBus } from '@/lib/events/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `GET /api/account`
 *
 * The caller's own account summary: every linked Nostr identity (one
 * primary), every passkey credential, and the managed-key custody state.
 * Powers the Account Settings page.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await authenticate(request)
  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const user = await prisma.user.findUnique({
    where: { id: account.id },
    select: {
      id: true,
      pubkey: true,
      nostrIdentities: {
        select: { pubkey: true, isPrimary: true, label: true, createdAt: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
      },
      passkeyCredentials: { orderBy: { createdAt: 'asc' } },
      managedNostrKey: { select: { exportedAt: true, ciphertext: true } }
    }
  })
  if (!user) throw new NotFoundError('Account not found')

  // Which identity does the server custody the secret key for? The managed
  // nsec derives to exactly one pubkey (the account's original key). We
  // decrypt only to derive that pubkey — the plaintext never leaves the
  // server and is discarded. A vault misconfig degrades to "no badge"
  // rather than failing the whole account read.
  let custodiedPubkey: string | null = null
  if (user.managedNostrKey && isVaultConfigured()) {
    try {
      const hex = decryptNsec(user.managedNostrKey.ciphertext, user.id)
      custodiedPubkey = getPublicKeyFromPrivate(hex)
    } catch (err) {
      logger.error(
        { userId: user.id, err },
        'Failed to derive custodied pubkey for account summary'
      )
    }
  }

  return NextResponse.json({
    userId: user.id,
    primaryPubkey: user.pubkey,
    identities: user.nostrIdentities.map(i => ({
      pubkey: i.pubkey,
      isPrimary: i.isPrimary,
      label: i.label,
      createdAt: i.createdAt.toISOString(),
      // True for the identity whose secret key the server holds (exportable
      // via a passkey assertion). At most one identity per account today.
      custodied: i.pubkey === custodiedPubkey
    })),
    credentials: user.passkeyCredentials.map(toCredentialSummary),
    hasManagedKey: !!user.managedNostrKey,
    managedKeyExported: !!user.managedNostrKey?.exportedAt
  })
})

/**
 * `DELETE /api/account`
 *
 * Permanently deletes the caller's account and everything it owns (see
 * `deleteAccount`): lightning addresses are released, cards unpaired. The
 * optional body `{ confirm: "DELETE" }` is an explicit confirmation; any
 * other `confirm` value is a 400. 403 for the instance root or the last
 * admin. Required for App Store guideline 5.1.1(v) — the native wallets
 * call this from Settings, then wipe the local key.
 */
export const DELETE = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'account-delete:' + auth.pubkey
  })

  try {
    await validateBody(request, accountDeleteRequestSchema)
  } catch (error) {
    // The body is optional: only a body that parses yet fails the schema 400s.
    if (!(error instanceof JsonParseError)) throw error
  }

  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  await deleteAccount(account.id)

  const now = Date.now()
  eventBus.emit({ type: 'users:updated', timestamp: now })
  eventBus.emit({ type: 'addresses:updated', timestamp: now })
  eventBus.emit({ type: 'cards:updated', timestamp: now })
  eventBus.emit({ type: 'listener:updated', timestamp: now })

  return NextResponse.json({ deleted: true })
})
