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
