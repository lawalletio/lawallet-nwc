import { z } from 'zod'
import { hexPubkeySchema } from '@lawallet-nwc/shared'
import {
  commonErrorResponses,
  inlineJsonResponse,
  jsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { errorResponse, responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Account'

const pubkeyParams = z.object({
  pubkey: hexPubkeySchema.openapi({
    description: 'The linked identity’s Nostr pubkey (64-char lowercase hex).',
  }),
})

// ── Summary ────────────────────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/account',
  tags: [TAG],
  summary: 'Get the caller’s account summary.',
  description:
    'The caller’s own account: every linked Nostr identity (exactly one is ' +
    'primary and mirrors the account’s public pubkey), every passkey ' +
    'credential, and the managed-key custody state. Powers the Account ' +
    'Settings page.',
  operationId: 'account.get',
  security: protectedSecurity,
  responses: {
    200: jsonResponse('The caller’s account summary.', 'AccountSummaryResponse'),
    ...commonErrorResponses,
    404: errorResponse('No account exists for the authenticated pubkey.'),
  },
})

// ── Identity linking (proof of another key) ────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/account/identities/link/begin',
  tags: [TAG],
  summary: 'Start proving control of another Nostr key.',
  description:
    'First leg of linking another Nostr key (or merging another account) into ' +
    'the caller’s account. `method: "nostr"` returns a challenge token plus a ' +
    'nonce; the other key signs a NIP-42-style kind-22242 event carrying the ' +
    'nonce in a `challenge` tag, and the pair goes to `link/verify`. ' +
    '`method: "passkey"` needs no server state here — the client obtains a ' +
    'standard LOGIN assertion via `POST /api/auth/passkey/authentication/options` ' +
    'and submits it to `link/verify` directly (single-use challenge semantics ' +
    'included), so only `expiresIn` is returned.',
  operationId: 'account.link.begin',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.AccountLinkBeginRequest },
      },
    },
  },
  responses: {
    200: jsonResponse(
      'Proof bootstrap. `challenge` + `nonce` for the nostr method; both absent for passkey.',
      'AccountLinkBeginResponse',
    ),
    ...commonErrorResponses,
    404: errorResponse('No account exists for the authenticated pubkey.'),
    429: responses.rateLimited,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/account/identities/link/verify',
  tags: [TAG],
  summary: 'Verify the proof and link or stage a merge.',
  description:
    'Second leg of the link/merge flow. The caller proves control of another ' +
    'key — a kind-22242 event signed by it (nostr) or a WebAuthn assertion ' +
    'for a stored credential (passkey) — and the outcome depends on where ' +
    'that key lives. Unowned pubkey: attached to the caller’s account as a ' +
    'secondary identity (`linked: true` + `identity`). Owned by another ' +
    'account: nothing is written; a short-lived merge ticket bound to the ' +
    '(caller, other account) pair is returned together with the other ' +
    'account’s resource summary for the side-by-side preview ' +
    '(`linked: false` + `mergeTicket` + `otherAccount`). Already on the ' +
    'caller’s account: 409.',
  operationId: 'account.link.verify',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.AccountLinkVerifyRequest },
      },
    },
  },
  responses: {
    200: jsonResponse(
      'Proof accepted — identity linked, or a merge ticket staged.',
      'AccountLinkVerifyResponse',
    ),
    ...commonErrorResponses,
    401: errorResponse(
      'Missing/invalid authentication, or the proof failed: expired or burned ' +
        'challenge, an event that does not answer it, a bad signature, or an ' +
        'unknown/invalid WebAuthn assertion.',
    ),
    404: errorResponse('No account exists for the authenticated pubkey.'),
    409: errorResponse('This key is already linked to the caller’s account.'),
    429: responses.rateLimited,
  },
})

// ── Merge ──────────────────────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/account/merge/preview',
  tags: [TAG],
  summary: 'Preview an account merge (dry run).',
  description:
    'Read-only dry run of a merge: both accounts’ resource summaries, the ' +
    'collisions the merge would reconcile, and whether it is blocked because ' +
    'the absorbed account custodies a never-exported key. Requires a valid ' +
    'merge ticket from `link/verify` — possession of the ticket IS the proof ' +
    'that the caller controls both accounts. Nothing is written.',
  operationId: 'account.merge.preview',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.AccountMergePreviewRequest },
      },
    },
  },
  responses: {
    200: jsonResponse('Merge dry-run summary.', 'AccountMergePreviewResponse'),
    ...commonErrorResponses,
    401: errorResponse(
      'Missing/invalid authentication, or the merge ticket is invalid, ' +
        'expired, or bound to a different account.',
    ),
    404: errorResponse('No account exists for the authenticated pubkey, or one side of the merge no longer exists.'),
    429: responses.rateLimited,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/account/merge',
  tags: [TAG],
  summary: 'Commit an account merge.',
  description:
    'Destructive commit. The merge ticket (from `link/verify`) proves the ' +
    'caller controls both accounts; `mainPubkey` selects which of the ' +
    'combined identities becomes primary. The absorbed account’s resources ' +
    'are re-parented onto the caller’s account inside one transaction and its ' +
    'User row is deleted. Refused with 409 while the absorbed account ' +
    'custodies a never-exported key — export it first. The caller’s session ' +
    'stays valid (its JWT pubkey remains one of the merged identities), but ' +
    'clients should refresh their token so the session presents the new ' +
    'primary.',
  operationId: 'account.merge',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.AccountMergeRequest },
      },
    },
  },
  responses: {
    200: jsonResponse('Merge committed.', 'AccountMergeResponse'),
    ...commonErrorResponses,
    401: errorResponse(
      'Missing/invalid authentication, or the merge ticket is invalid, ' +
        'expired, or bound to a different account.',
    ),
    404: errorResponse('No account exists for the authenticated pubkey, or one side of the merge no longer exists.'),
    409: errorResponse(
      'The absorbed account custodies a never-exported Nostr key — export it ' +
        'via the passkey nsec-export flow before merging.',
    ),
    429: responses.rateLimited,
  },
})

// ── Identity management ────────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/account/identities/{pubkey}',
  tags: [TAG],
  summary: 'Rename an identity or promote it to primary.',
  description:
    'Ownership-scoped: an identity that does not exist or belongs to another ' +
    'account returns 404 (never 403) so pubkeys cannot be enumerated. `label` ' +
    'renames (null clears it); `isPrimary: true` promotes the identity, ' +
    'mirroring the new primary onto the account’s public pubkey — the caller ' +
    'should refresh its session token afterwards so the JWT presents the new ' +
    'primary.',
  operationId: 'account.identities.update',
  security: protectedSecurity,
  request: {
    params: pubkeyParams,
    body: {
      content: {
        'application/json': { schema: schemas.UpdateIdentityRequest },
      },
    },
  },
  responses: {
    200: jsonResponse('The updated identity.', 'NostrIdentitySummary'),
    ...commonErrorResponses,
    404: errorResponse('Identity not found (or not owned by the caller).'),
    429: responses.rateLimited,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/account/identities/{pubkey}',
  tags: [TAG],
  summary: 'Unlink a secondary identity.',
  description:
    'Detaches a SECONDARY identity from the caller’s account; the pubkey ' +
    'becomes a bare key again and can be re-linked later. The primary ' +
    'identity cannot be unlinked (409 — promote another identity first) and ' +
    'neither can the last remaining identity (409). Ownership-scoped (404, ' +
    'never 403).',
  operationId: 'account.identities.delete',
  security: protectedSecurity,
  request: { params: pubkeyParams },
  responses: {
    200: inlineJsonResponse(
      'Identity unlinked.',
      z.object({ message: z.string(), pubkey: z.string() }),
    ),
    ...commonErrorResponses,
    404: errorResponse('Identity not found (or not owned by the caller).'),
    409: errorResponse(
      'The identity is the account’s primary (promote another identity ' +
        'first) or its last remaining identity.',
    ),
    429: responses.rateLimited,
  },
})
