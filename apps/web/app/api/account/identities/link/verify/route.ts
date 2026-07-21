import { NextResponse } from 'next/server'
import type { Event as NostrEvent } from 'nostr-tools/pure'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { accountLinkVerifyRequestSchema } from '@/lib/validation/schemas'
import { verifyNostrLinkProof, mintMergeTicket } from '@/lib/account/proof'
import { verifyStoredCredentialAssertion } from '@/lib/auth/passkey'
import { linkPubkeyToAccount, previewMerge } from '@/lib/account/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /api/account/identities/link/verify`
 *
 * Second leg of the link/merge flow. The caller proves control of another
 * key — a NIP-42 event signed by it (nostr) or a WebAuthn assertion for a
 * credential (passkey) — and the outcome depends on where that key lives:
 *
 * - **Unowned pubkey** → attached to the caller's account as a secondary
 *   identity; `{ linked: true, identity }`.
 * - **Owned by another account** → nothing is written; a short-lived merge
 *   ticket bound to (caller, other account) is returned together with the
 *   other account's resource summary for the side-by-side preview:
 *   `{ linked: false, mergeTicket, otherAccount }`.
 * - **Already on the caller's account** → 409.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticate(request)
  await rateLimit(request, {
    ...RateLimitPresets.sensitive,
    identifier: 'account-link:' + auth.pubkey
  })

  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Account not found')

  const body = await validateBody(request, accountLinkVerifyRequestSchema)

  // ── Prove control → the proven pubkey (and, for passkeys, its account) ──
  let provenPubkey: string
  let provenAccountId: string | null = null
  let label: string | undefined

  if (body.method === 'nostr') {
    provenPubkey = verifyNostrLinkProof({
      challenge: body.challenge,
      event: body.event as NostrEvent,
      accountId: account.id
    })
    label = body.label
    const owner = await resolveAccountByPubkey(provenPubkey)
    provenAccountId = owner?.id ?? null
  } else {
    // A LOGIN-flow assertion proves control of the credential — and thereby
    // of the account that owns it. Single-use challenge; clone detection and
    // counter bump included.
    const credential = await verifyStoredCredentialAssertion({
      challenge: body.challenge,
      credential: body.credential,
      flow: 'LOGIN'
    })
    provenAccountId = credential.userId
    provenPubkey = credential.user.pubkey
  }

  // ── Decide: attach vs merge ticket ──────────────────────────────────────
  if (provenAccountId === account.id) {
    throw new ConflictError('This key is already linked to your account')
  }

  if (provenAccountId === null) {
    // Bare key, no account: attach directly as a secondary identity.
    await linkPubkeyToAccount(account.id, provenPubkey, label)
    const identity = await prisma.nostrIdentity.findUnique({
      where: { pubkey: provenPubkey }
    })
    return NextResponse.json({
      linked: true,
      identity: identity && {
        pubkey: identity.pubkey,
        isPrimary: identity.isPrimary,
        label: identity.label,
        createdAt: identity.createdAt.toISOString()
      }
    })
  }

  // The key belongs to another account: hand back a merge ticket + preview
  // data. No writes happen until POST /api/account/merge.
  const preview = await previewMerge(account.id, provenAccountId)
  const mergeTicket = mintMergeTicket({
    survivorId: account.id,
    absorbedId: provenAccountId,
    provenPubkey
  })

  return NextResponse.json({
    linked: false,
    mergeTicket,
    otherAccount: preview.absorbed
  })
})
