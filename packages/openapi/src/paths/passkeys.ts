import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  jsonResponse,
  protectedSecurity,
  publicSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { errorResponse, responses } from '../responses'
import { PasskeyCredentialSummary, schemas } from '../schemas'

const TAG = 'Passkeys'

// Registration verify branches on the caller's auth: unauthenticated =
// signup, authenticated (Bearer JWT or NIP-98) = add-a-passkey. The empty
// requirement object is the OpenAPI idiom for "auth optional".
const optionalSecurity = [{}, ...protectedSecurity]

// ── Registration (signup AND add-to-account) ───────────────────────────────

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/registration/options',
  tags: [TAG],
  summary: 'Start creating a passkey (signup or add-to-account).',
  description:
    'Mints WebAuthn registration options. One ceremony serves BOTH new-account ' +
    'signup and adding a passkey to an existing account — `verify` branches on ' +
    'the caller’s auth there, so this leg is unauthenticated. The credential’s ' +
    'Nostr identity is derived CLIENT-SIDE via the WebAuthn PRF extension; the ' +
    'server only records credentials and never holds a key, so there is no ' +
    'key-vault gating. Nothing is persisted besides the single-use challenge; ' +
    'the WebAuthn user handle is random opaque bytes (the account is keyed by ' +
    'the PRF-derived pubkey, not the handle). The body is optional; a ' +
    'malformed body is tolerated because the label is only applied at verify ' +
    'time.',
  operationId: 'passkey.registration.options',
  security: publicSecurity,
  request: {
    body: {
      required: false,
      content: {
        'application/json': { schema: schemas.PasskeyRegistrationOptionsRequest }
      }
    }
  },
  responses: {
    200: jsonResponse(
      'WebAuthn registration options. The challenge is stored server-side, single-use.',
      'PasskeyOptionsResponse'
    ),
    429: responses.rateLimited,
    500: responses.internalError,
    503: errorResponse(
      'Passkey login is not configured — JWT auth is disabled on this instance.'
    )
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/registration/verify',
  tags: [TAG],
  summary: 'Complete creating a passkey (signup or add-to-account).',
  description:
    'Verifies the authenticator’s attestation against the single-use challenge ' +
    'minted by `registration/options`, plus the PRF proof: the client derived ' +
    'this credential’s Nostr key via the WebAuthn PRF extension and proves it ' +
    'with a NIP-42 (kind 22242) event signed by that key, carrying the ' +
    'WebAuthn challenge in a `challenge` tag. The server then only RECORDS ' +
    'the credential — it never generates or stores a key. Branches on the ' +
    'caller: UNAUTHENTICATED (signup) — an unowned derived pubkey creates the ' +
    'account; an already-owned pubkey (the same passkey re-registered) just ' +
    'attaches the new credential to its account. AUTHENTICATED (Bearer JWT or ' +
    'NIP-98; add a passkey) — the derived pubkey is linked to the caller’s ' +
    'account as a secondary identity. No token is minted here: the client ' +
    'follows up with a normal NIP-98 login using the derived key.',
  operationId: 'passkey.registration.verify',
  security: optionalSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyRegistrationVerifyRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Passkey recorded. Log in next with a normal NIP-98 exchange using the derived key.',
      z.object({
        pubkey: z.string().openapi({
          description:
            'The PRF-derived Nostr pubkey this credential IS — the identity it signs for.'
        }),
        credential: PasskeyCredentialSummary
      })
    ),
    400: responses.validation,
    401: errorResponse(
      'Passkey verification failed — bad attestation, wrong origin/rpID, ' +
        'burned or expired challenge, or a pubkey proof event that does not ' +
        'check out. Every failure path returns this same generic message — no ' +
        'oracle. Also returned when an Authorization header is present but ' +
        'invalid: a bad credential never silently downgrades to signup.'
    ),
    409: errorResponse(
      'The credential id is already registered, or (authenticated add) the ' +
        'derived pubkey belongs to a DIFFERENT account — the UI offers the ' +
        'account-merge flow for that case.'
    ),
    429: responses.rateLimited,
    500: responses.internalError
  }
})

// ── Credential management ──────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/auth/passkey/credentials',
  tags: [TAG],
  summary: 'List the caller’s passkeys.',
  description:
    'Returns credential summaries only — never the stored public key or ' +
    'signature counter. `hasManagedKey` and `managedKeyExported` describe the ' +
    'pre-PRF custody state: whether the server still custodies a Nostr key ' +
    'for this account, and whether that key has ever been exported ' +
    '(`managedKeyExported` is always false when there is no managed key).',
  operationId: 'passkey.credentials.list',
  security: protectedSecurity,
  responses: {
    200: jsonResponse('The caller’s passkeys.', 'PasskeyCredentialListResponse'),
    ...commonErrorResponses,
    404: errorResponse('No `User` row exists for the authenticated pubkey.')
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'patch',
  path: '/api/auth/passkey/credentials/{id}',
  tags: [TAG],
  summary: 'Rename a passkey.',
  description:
    'Ownership-scoped: a credential that does not exist or belongs to another ' +
    'user returns 404 (never 403) so credential ids cannot be enumerated. Only ' +
    'the label is mutable.',
  operationId: 'passkey.credentials.update',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyCredentialUpdateRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Passkey renamed.',
      z.object({ credential: PasskeyCredentialSummary })
    ),
    ...commonErrorResponses,
    404: errorResponse('Passkey not found (or not owned by the caller).')
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'delete',
  path: '/api/auth/passkey/credentials/{id}',
  tags: [TAG],
  summary: 'Delete a passkey.',
  description:
    'Removes the LOGIN-METHOD record only. Under the PRF model the passkey’s ' +
    'derived Nostr identity (and its key) live entirely client-side, so ' +
    'nothing is orphaned and no last-credential/export guard applies. The ' +
    'derived identity stays linked to the account until unlinked explicitly ' +
    'via `DELETE /api/account/identities/{pubkey}`. Ownership-scoped (404, ' +
    'never 403).',
  operationId: 'passkey.credentials.delete',
  security: protectedSecurity,
  request: { params: schemas.IdParam },
  responses: {
    200: inlineJsonResponse(
      'Passkey deleted.',
      z.object({ message: z.string(), id: z.string() })
    ),
    ...commonErrorResponses,
    404: errorResponse('Passkey not found (or not owned by the caller).'),
    429: responses.rateLimited
  }
})
