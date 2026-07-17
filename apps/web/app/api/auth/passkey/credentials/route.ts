import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { toCredentialSummary } from '@/lib/auth/passkey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `GET /api/auth/passkey/credentials` — list the caller's passkeys.
 *
 * Returns credential summaries only (`toCredentialSummary`) — never the
 * stored public key or signature counter — plus `hasManagedKey`, which tells
 * the client whether this account's Nostr key is server-custodied
 * (passkey-native signup) or linked to an external signer. Matches
 * `passkeyCredentialListResponseSchema`.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await authenticate(request)

  const user = await prisma.user.findUnique({
    where: { pubkey: auth.pubkey },
    select: { id: true }
  })
  if (!user) throw new NotFoundError('User not found')

  const [credentials, managed] = await Promise.all([
    prisma.passkeyCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.managedNostrKey.findUnique({ where: { userId: user.id } })
  ])

  return NextResponse.json({
    credentials: credentials.map(toCredentialSummary),
    hasManagedKey: !!managed
  })
})
