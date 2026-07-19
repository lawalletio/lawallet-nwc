import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { idParam, updatePasskeyCredentialSchema } from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { toCredentialSummary } from '@/lib/auth/passkey'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import type { PasskeyCredential } from '@/lib/generated/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolves the caller's user row and the credential at `params.id`, enforcing
 * ownership. Non-existent and not-owned both 404 (never 403) so credential
 * ids can't be enumerated by probing.
 */
async function resolveOwnedCredential(
  pubkey: string,
  params: Promise<{ id: string }>
): Promise<{ userId: string; credential: PasskeyCredential }> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { id: true }
  })
  if (!user) throw new NotFoundError('User not found')

  const { id } = validateParams(await params, idParam)

  const credential = await prisma.passkeyCredential.findUnique({
    where: { id }
  })
  if (!credential || credential.userId !== user.id) {
    throw new NotFoundError('Passkey not found')
  }

  return { userId: user.id, credential }
}

/**
 * `PATCH /api/auth/passkey/credentials/[id]` — rename a passkey.
 *
 * Ownership-scoped (404-not-403). Only the label is mutable — key material,
 * counter, and device metadata are fixed at registration.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticate(request)

    const { userId, credential } = await resolveOwnedCredential(
      auth.pubkey,
      params
    )

    const body = await validateBody(request, updatePasskeyCredentialSchema)

    const updated = await prisma.passkeyCredential.update({
      where: { id: credential.id },
      data: { label: body.label }
    })

    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.PASSKEY_RENAMED,
      message: `Passkey renamed to "${body.label}"`,
      userId,
      metadata: { credentialId: credential.id }
    })

    return NextResponse.json({ credential: toCredentialSummary(updated) })
  }
)

/**
 * `DELETE /api/auth/passkey/credentials/[id]` — remove a passkey.
 *
 * Deleting a credential is a hard revocation: passkey session JWTs carry the
 * credential id in their `cred` claim and key-releasing endpoints check it
 * live. Last-credential guard: when this is the account's only passkey AND
 * the server custodies its Nostr key that hasn't been exported yet, deletion
 * would orphan the account — 409 until the user exports the key or adds
 * another passkey. Linked accounts (external signer) can always delete.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticate(request)

    // Per-user bucket so one caller behind a shared proxy can't exhaust
    // another's allowance on this destructive endpoint.
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      identifier: `passkey-delete:${auth.pubkey}`,
      isAuthenticated: true
    })

    const { userId, credential } = await resolveOwnedCredential(
      auth.pubkey,
      params
    )

    const count = await prisma.passkeyCredential.count({ where: { userId } })
    if (count === 1) {
      const managed = await prisma.managedNostrKey.findUnique({
        where: { userId }
      })
      if (managed && !managed.exportedAt) {
        throw new ConflictError(
          'Export your Nostr key or add another passkey before deleting the last one'
        )
      }
    }

    await prisma.passkeyCredential.delete({ where: { id: credential.id } })

    logActivity.fireAndForget({
      category: 'USER',
      event: ActivityEvent.PASSKEY_DELETED,
      message: `Passkey deleted${credential.label ? ` ("${credential.label}")` : ''}`,
      userId,
      metadata: { credentialId: credential.id, lastCredential: count === 1 }
    })

    return NextResponse.json({ message: 'Passkey deleted', id: credential.id })
  }
)
