import { z } from 'zod'
import { passkeySessionResponseSchema } from '@lawallet-nwc/shared'
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
import { BEARER_JWT } from '../security'

const TAG = 'Passkeys'

// Bearer-only endpoints validate the raw JWT themselves to reach the
// passkey-specific claims (`amr`/`cred`/`auth_time`) that unified auth does
// not surface — a NIP-98 request can never qualify.
const bearerOnlySecurity = [{ [BEARER_JWT]: [] }]

// ── Registration (new-account signup) ──────────────────────────────────────

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/registration/options',
  tags: [TAG],
  summary: 'Start a new-account passkey signup.',
  description:
    'Mints WebAuthn registration options for a brand-new managed identity. ' +
    'Unauthenticated — anyone may begin a signup ceremony; nothing is persisted ' +
    'besides the single-use challenge. A user id is pre-allocated (it travels as ' +
    'the WebAuthn user handle) but no `User` row is created until `verify` proves ' +
    'possession of the authenticator. The body is optional; a malformed body is ' +
    'tolerated because the label is only applied at verify time.',
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
      'Passkey signup is not configured — the key vault or JWT support is missing on this instance.'
    )
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/registration/verify',
  tags: [TAG],
  summary: 'Complete a new-account passkey signup.',
  description:
    'Verifies the authenticator’s attestation against the single-use challenge ' +
    'minted by `registration/options`, then materializes the account: a fresh ' +
    'server-generated Nostr identity (custodied at rest in the key vault), the ' +
    '`User` row, and the passkey credential itself. The private key (`signerKey`) ' +
    'is returned exactly ONCE — here — so the client can build its in-memory ' +
    'signer without a second round-trip; afterwards it is only obtainable via ' +
    'the signer-key and nsec-export flows.',
  operationId: 'passkey.registration.verify',
  security: publicSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyRegistrationVerifyRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Account created; passkey session issued.',
      passkeySessionResponseSchema
        .extend({
          signerKey: z.string().openapi({
            description:
              'Server-generated Nostr private key (hex) — returned exactly once, ' +
              'at account creation. Afterwards obtainable only via ' +
              '`GET /api/auth/passkey/signer-key` or the nsec-export step-up flow.'
          })
        })
        .openapi({
          description:
            'PasskeySessionResponse plus the one-time `signerKey` (custody is always `managed` here).'
        })
    ),
    400: responses.validation,
    401: errorResponse(
      'Passkey verification failed. Every failure path (bad attestation, wrong ' +
        'origin/rpID, burned or expired challenge) returns this same generic ' +
        'message — no oracle.'
    ),
    409: errorResponse('This passkey (credential id) is already registered.'),
    429: responses.rateLimited,
    500: responses.internalError,
    503: errorResponse(
      'Passkey signup is not configured — the key vault is missing on this instance.'
    )
  }
})

// ── Link (attach a passkey to an existing account) ─────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/auth/passkey/link/options',
  tags: [TAG],
  summary: 'Start linking a passkey to the authenticated account.',
  description:
    'Mints WebAuthn registration options so an existing, currently authenticated ' +
    'user (NIP-98 or Bearer JWT) can attach a passkey to their account. The ' +
    'challenge is bound to the caller’s user id and re-checked at verify time. ' +
    'Authenticators the account already registered are excluded so the OS picker ' +
    'greys them out. Never creates accounts — that is the registration flow’s job.',
  operationId: 'passkey.link.options',
  security: protectedSecurity,
  responses: {
    200: jsonResponse(
      'WebAuthn registration options. The challenge is stored server-side, single-use, bound to the caller.',
      'PasskeyOptionsResponse'
    ),
    ...commonErrorResponses,
    404: errorResponse('No `User` row exists for the authenticated pubkey.'),
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/auth/passkey/link/verify',
  tags: [TAG],
  summary: 'Complete linking a passkey to the authenticated account.',
  description:
    'Verifies the attestation against the single-use challenge minted by ' +
    '`link/options` and attaches the new credential to the CURRENTLY ' +
    'authenticated user. The challenge is re-bound to the caller at consume ' +
    'time, so a challenge minted for account A can never attach a passkey to ' +
    'account B. Only the credential is created — the server never takes custody ' +
    'of a linked user’s Nostr key.',
  operationId: 'passkey.link.verify',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyRegistrationVerifyRequest }
      }
    }
  },
  responses: {
    201: inlineJsonResponse(
      'Passkey linked.',
      z.object({ credential: PasskeyCredentialSummary })
    ),
    ...commonErrorResponses,
    404: errorResponse('No `User` row exists for the authenticated pubkey.'),
    409: errorResponse('This passkey (credential id) is already registered.'),
    429: responses.rateLimited
  }
})

// ── Authentication (username-less login) ───────────────────────────────────

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/authentication/options',
  tags: [TAG],
  summary: 'Start a passkey login (username-less).',
  description:
    'Unauthenticated first leg of a passkey login. Mints WebAuthn assertion ' +
    'options with an empty `allowCredentials` list — discoverable-credential ' +
    '(username-less) login: the authenticator picks which resident passkey to ' +
    'use, so the server learns nothing about who is logging in until the signed ' +
    'assertion comes back. Available even when the key vault is unconfigured, ' +
    'so linked-custody users can always log in.',
  operationId: 'passkey.authentication.options',
  security: publicSecurity,
  responses: {
    200: jsonResponse(
      'WebAuthn assertion options. The challenge is stored server-side, single-use.',
      'PasskeyOptionsResponse'
    ),
    429: responses.rateLimited,
    500: responses.internalError
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/auth/passkey/authentication/verify',
  tags: [TAG],
  summary: 'Complete a passkey login.',
  description:
    'Unauthenticated second leg of a passkey login. Consumes the single-use ' +
    'LOGIN challenge, verifies the WebAuthn assertion against the stored ' +
    'credential, applies signature-counter clone detection, and mints a passkey ' +
    'session JWT (`amr: ["webauthn"]`, `cred`, `custody`, `auth_time`) identical ' +
    'in base shape to `POST /api/jwt`.',
  operationId: 'passkey.authentication.verify',
  security: publicSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyAuthenticationVerifyRequest }
      }
    }
  },
  responses: {
    200: jsonResponse('Login verified; passkey session issued.', 'PasskeySessionResponse'),
    400: responses.validation,
    401: errorResponse(
      'Passkey verification failed. Unknown credential, bad signature, wrong ' +
        'origin/rpID, burned challenge, and counter regression all return this ' +
        'same generic message — no oracle.'
    ),
    429: responses.rateLimited,
    500: responses.internalError
  }
})

// ── Custodied key release ──────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/auth/passkey/signer-key',
  tags: [TAG],
  summary: 'Release the custodied Nostr signer key to a passkey session.',
  description:
    'Returns the server-custodied Nostr private key (hex) so the client can ' +
    'construct an in-memory signer. Bearer-only and stricter than normal auth: ' +
    'the JWT must carry the passkey claims (`amr: ["webauthn"]` + `cred`) minted ' +
    'by the WebAuthn login/refresh flow — a NIP-98-exchanged JWT or a QR device ' +
    'token can never unlock key material. The `cred` claim is re-checked against ' +
    'a live credential row on every call, so deleting a passkey is a hard ' +
    'revocation. The response is a secret and is never cached.',
  operationId: 'passkey.signerKey',
  security: bearerOnlySecurity,
  responses: {
    200: inlineJsonResponse(
      'Custodied signer key released.',
      z.object({
        signerKey: z.string().openapi({
          description: 'The account’s Nostr private key, hex-encoded. Treat as a secret.'
        }),
        pubkey: z.string()
      })
    ),
    401: errorResponse(
      'Invalid session for key access — missing/expired Bearer token, token ' +
        'without the passkey claims, or the credential in `cred` no longer ' +
        'exists or belongs to another pubkey.'
    ),
    404: errorResponse(
      'No managed key for this account — linked custody; the user brought their own signer.'
    ),
    429: responses.rateLimited,
    500: responses.internalError
  }
})

// ── nsec export (step-up) ──────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/auth/passkey/nsec/export/options',
  tags: [TAG],
  summary: 'Start the nsec-export step-up ceremony.',
  description:
    'Mints a fresh WebAuthn authentication challenge bound to the EXPORT flow, ' +
    'restricted to the caller’s own credentials. A login challenge can never be ' +
    'replayed to unlock an export — the flow is pinned server-side and checked ' +
    'on consumption.',
  operationId: 'passkey.nsec.export.options',
  security: protectedSecurity,
  responses: {
    200: jsonResponse(
      'WebAuthn assertion options for the EXPORT flow. Single-use, bound to the caller.',
      'PasskeyOptionsResponse'
    ),
    ...commonErrorResponses,
    404: errorResponse(
      'User not found, no managed key for this account, or no passkey available ' +
        'to step up with. Always 404 — never 403 — matching the ownership idiom ' +
        'used across the API.'
    ),
    429: responses.rateLimited
  }
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/auth/passkey/nsec/export',
  tags: [TAG],
  summary: 'Export the custodied nsec after a passkey step-up.',
  description:
    'Completes the step-up ceremony and releases the custodied Nostr key in ' +
    'NIP-19 `nsec` form. The most sensitive endpoint in the system: requires a ' +
    'fresh EXPORT-flow WebAuthn assertion (single-use challenge bound to the ' +
    'authenticated user) verified against a credential the user owns, applies ' +
    'clone detection, marks the key exported, and always logs the export. The ' +
    'response is a secret and is never cached.',
  operationId: 'passkey.nsec.export',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': { schema: schemas.PasskeyNsecExportRequest }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Custodied key exported.',
      z.object({
        nsec: z.string().openapi({
          description: 'The account’s Nostr private key in NIP-19 `nsec` form. Treat as a secret.'
        }),
        pubkey: z.string()
      })
    ),
    ...commonErrorResponses,
    404: errorResponse('User not found, or no managed key for this account.'),
    429: responses.rateLimited
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
    'signature counter — plus `hasManagedKey`, which tells the client whether ' +
    'this account’s Nostr key is server-custodied (passkey-native signup) or ' +
    'linked to an external signer.',
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
    'Hard revocation: passkey session JWTs carry the credential id in their ' +
    '`cred` claim and key-releasing endpoints check it live, so deletion kills ' +
    'those sessions immediately. Last-credential guard: when this is the ' +
    'account’s only passkey AND the server custodies a Nostr key that has not ' +
    'been exported yet, deletion would orphan the account — 409 until the user ' +
    'exports the key or adds another passkey. Linked accounts can always delete. ' +
    'Ownership-scoped (404, never 403).',
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
    409: errorResponse(
      'Last-credential guard: export your Nostr key or add another passkey ' +
        'before deleting the last one.'
    ),
    429: responses.rateLimited
  }
})

// ── Session refresh ────────────────────────────────────────────────────────

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/auth/passkey/session/refresh',
  tags: [TAG],
  summary: 'Re-issue a passkey session JWT.',
  description:
    'Bearer-only session continuity for passkey users (linked-custody users ' +
    'have no Nostr signer to run the NIP-98 `/api/jwt` refresh path). Only ' +
    'passkey session tokens qualify (`amr: ["webauthn"]` + `cred`); NIP-98 JWTs ' +
    'and device tokens are rejected. The credential row is re-checked live ' +
    '(hard revocation), the original `auth_time` is preserved and capped at 30 ' +
    'days — past that the user must perform a full WebAuthn login again — and ' +
    'role/permissions/custody are re-resolved so demotions propagate.',
  operationId: 'passkey.session.refresh',
  security: bearerOnlySecurity,
  responses: {
    200: jsonResponse('Session refreshed.', 'PasskeySessionResponse'),
    401: errorResponse(
      'Invalid or expired token, a non-passkey session, a revoked credential, ' +
        'or a refresh chain past the 30-day cap.'
    ),
    429: responses.rateLimited,
    500: responses.internalError
  }
})
