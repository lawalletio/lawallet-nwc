import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { toCredentialSummary } from '@/lib/auth/passkey'

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
      managedNostrKey: { select: { exportedAt: true } }
    }
  })
  if (!user) throw new NotFoundError('Account not found')

  return NextResponse.json({
    userId: user.id,
    primaryPubkey: user.pubkey,
    identities: user.nostrIdentities.map(i => ({
      pubkey: i.pubkey,
      isPrimary: i.isPrimary,
      label: i.label,
      createdAt: i.createdAt.toISOString()
    })),
    credentials: user.passkeyCredentials.map(toCredentialSummary),
    hasManagedKey: !!user.managedNostrKey,
    managedKeyExported: !!user.managedNostrKey?.exportedAt
  })
})
