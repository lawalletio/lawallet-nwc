import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import type { Event as NostrEvent } from 'nostr-tools/pure'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { passkeyRegistrationVerifyRequestSchema } from '@/lib/validation/schemas'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { verifySignedChallengeEvent } from '@/lib/account/proof'
import { linkPubkeyToAccount } from '@/lib/account/merge'
import { createNewUser } from '@/lib/user'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { consumeWebAuthnChallenge, toCredentialSummary } from '@/lib/auth/passkey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GENERIC_FAILURE = 'Passkey verification failed'

/**
 * `POST /api/auth/passkey/registration/verify`
 *
 * Second leg of passkey creation under the PRF model. The client evaluated
 * the PRF and derived this credential's Nostr key, and proves it by signing
 * a NIP-42 (kind 22242) event whose `challenge` tag is the WebAuthn
 * challenge — the server verifies the attestation AND the proof, then only
 * RECORDS the credential; it never generates or stores a key.
 *
 * Branches on the caller:
 * - **Unauthenticated (signup)** — derived pubkey unowned → create the
 *   account (`createNewUser`, wallet auto-provisioning applies); already
 *   owned (same passkey re-registered → same derived pubkey) → just attach
 *   the credential to that account. Either way the client follows up with a
 *   normal NIP-98 login using the derived key — no JWT is minted here.
 * - **Authenticated (add a passkey)** — the derived pubkey links to the
 *   caller's account as a SECONDARY identity (each passkey IS its own
 *   identity under PRF). A pubkey owned by a different account → 409, which
 *   the UI turns into the merge suggestion.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, { ...RateLimitPresets.auth })

  // Optional authentication: an absent header means signup; a PRESENT but
  // invalid header must fail loudly rather than silently downgrade.
  const caller = request.headers.get('authorization')
    ? await authenticate(request)
    : null
  const callerAccount = caller
    ? await resolveAccountByPubkey(caller.pubkey)
    : null
  if (caller && !callerAccount) {
    throw new AuthenticationError('Account not found')
  }

  const body = await validateBody(request, passkeyRegistrationVerifyRequestSchema)

  // Single-use: the row is deleted on read, so replays fail generically.
  const row = await consumeWebAuthnChallenge(body.challenge, 'REGISTER')

  let verified = false
  let info: Awaited<
    ReturnType<typeof verifyRegistrationResponse>
  >['registrationInfo']
  try {
    const result = await verifyRegistrationResponse({
      response: body.credential as unknown as RegistrationResponseJSON,
      expectedChallenge: row.challenge,
      expectedOrigin: row.origin,
      expectedRPID: row.rpId,
      requireUserVerification: true
    })
    verified = result.verified
    info = result.registrationInfo
  } catch {
    verified = false
  }
  if (!verified || !info) {
    throw new AuthenticationError(GENERIC_FAILURE)
  }

  // The PRF-derived key must prove itself: a fresh kind-22242 event signed
  // by the claimed pubkey, answering this exact WebAuthn challenge. Without
  // this, anyone completing a ceremony could claim an arbitrary pubkey.
  verifySignedChallengeEvent(
    body.proof as NostrEvent,
    row.challenge,
    body.pubkey
  )

  const owner = await resolveAccountByPubkey(body.pubkey)

  // Resolve which account receives the credential.
  let userId: string
  let event: (typeof ActivityEvent)[keyof typeof ActivityEvent]
  if (callerAccount) {
    if (owner && owner.id !== callerAccount.id) {
      throw new ConflictError('This passkey belongs to another account')
    }
    if (!owner) {
      // Each passkey is its own identity — attach it as a secondary.
      await linkPubkeyToAccount(callerAccount.id, body.pubkey, body.label)
    }
    userId = callerAccount.id
    event = ActivityEvent.PASSKEY_LINKED
  } else if (owner) {
    // Signup with an already-registered passkey: same PRF → same pubkey →
    // same account. Attach the (new) credential and let the client log in.
    userId = owner.id
    event = ActivityEvent.PASSKEY_REGISTERED
  } else {
    const user = await createNewUser(body.pubkey)
    userId = user.id
    event = ActivityEvent.PASSKEY_REGISTERED
  }

  let credentialRow
  try {
    credentialRow = await prisma.passkeyCredential.create({
      data: {
        id: info.credential.id,
        userId,
        pubkey: body.pubkey,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: info.credential.transports
          ? JSON.stringify(info.credential.transports)
          : null,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid ?? null,
        label: body.label ?? null,
        rpId: row.rpId
      }
    })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') {
      throw new ConflictError('This passkey is already registered')
    }
    throw err
  }

  logActivity.fireAndForget({
    category: 'USER',
    event,
    message: `Passkey ${event === ActivityEvent.PASSKEY_LINKED ? 'added' : 'registered'} for ${body.pubkey.slice(0, 8)}…`,
    userId,
    metadata: { credentialId: credentialRow.id, pubkey: body.pubkey }
  })

  return NextResponse.json({
    pubkey: body.pubkey,
    credential: toCredentialSummary(credentialRow)
  })
})
