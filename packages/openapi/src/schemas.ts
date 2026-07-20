import {
  accountLinkBeginRequestSchema,
  accountLinkBeginResponseSchema,
  accountLinkVerifyRequestSchema,
  accountLinkVerifyResponseSchema,
  accountMergePreviewRequestSchema,
  accountMergePreviewResponseSchema,
  accountMergeRequestSchema,
  accountMergeResponseSchema,
  accountSummaryResponseSchema,
  cardScanCallbackQuerySchema,
  cardListQuerySchema,
  claimActivationTokenSchema,
  claimInvoiceSchema,
  createActivationTokenSchema,
  createCardDesignSchema,
  createCardSchema,
  createInvoiceSchema,
  createLncurlWalletSchema,
  createRemoteCardSchema,
  createRemoteWalletSchema,
  createWalletAddressSchema,
  externalDeviceKeyParam,
  idParam,
  jwtRequestSchema,
  qrJwtGenerateSchema,
  lightningAddressModeSchema,
  lud16CallbackQuerySchema,
  lud16UsernameParam,
  nostrIdentitySummarySchema,
  otcParam,
  passkeyAuthenticationVerifyRequestSchema,
  passkeyCredentialListResponseSchema,
  passkeyCredentialSummarySchema,
  passkeyNsecExportRequestSchema,
  passkeyRegistrationOptionsRequestSchema,
  passkeyRegistrationVerifyRequestSchema,
  passkeySessionResponseSchema,
  payActionQuerySchema,
  probeAliasAddressSchema,
  remoteWalletListQuerySchema,
  scanCardQuerySchema,
  settingsBodySchema,
  updateCardDesignSchema,
  updateIdentityRequestSchema,
  updateLightningAddressSchema,
  updatePasskeyCredentialSchema,
  updateRemoteWalletSchema,
  updateRoleSchema,
  updateWalletCardSchema,
  updateWalletAddressSchema,
  userIdParam,
  walletAddressUsernameParam,
} from '@lawallet-nwc/shared'
import { z } from 'zod'
import { registry } from './registry'

// Each schema is registered once as a reusable component. Path files
// reference these by name through `request.body` / `responses[…]` `$ref`
// fragments. If you add a Zod schema in @lawallet-nwc/shared, add it here so
// it shows up under `components/schemas` in the spec.

export const schemas = {
  // ── Common ─────────────────────────────────────────────────────────────
  IdParam: registry.register('IdParam', idParam),
  UserIdParam: registry.register('UserIdParam', userIdParam),

  // ── Cards ──────────────────────────────────────────────────────────────
  CardCreateRequest: registry.register(
    'CardCreateRequest',
    createCardSchema.openapi({
      description:
        'Create-card payload. `id` is the card UID (4- or 7-byte hex, colons ' +
        'optional); it is normalized to uppercase hex and used as the unique ' +
        'NTAG424 key, so re-using a UID returns 409 Conflict. `designId` must ' +
        'reference an existing design; `kind` defaults to `SIMPLE`.',
    }),
  ),
  CardListQuery: registry.register('CardListQuery', cardListQuerySchema),
  ScanCardQuery: registry.register('ScanCardQuery', scanCardQuerySchema),
  PayActionQuery: registry.register('PayActionQuery', payActionQuerySchema),
  CardScanCallbackQuery: registry.register(
    'CardScanCallbackQuery',
    cardScanCallbackQuerySchema,
  ),
  OtcParam: registry.register('OtcParam', otcParam),
  ActivationTokenCreateRequest: registry.register(
    'ActivationTokenCreateRequest',
    createActivationTokenSchema,
  ),
  ActivationTokenClaimRequest: registry.register(
    'ActivationTokenClaimRequest',
    claimActivationTokenSchema,
  ),

  // ── Card Designs ───────────────────────────────────────────────────────
  CardDesignCreateRequest: registry.register('CardDesignCreateRequest', createCardDesignSchema),
  CardDesignUpdateRequest: registry.register(
    'CardDesignUpdateRequest',
    // The .refine() on updateCardDesignSchema rejects no-op payloads. The
    // generator can't express that in JSON Schema, so we ship the body shape
    // and document the constraint in the description.
    updateCardDesignSchema.openapi({
      description:
        'Partial update for a card design. At least one field must be present, otherwise the route returns 400.',
    }),
  ),

  // ── Lightning Addresses ───────────────────────────────────────────────
  Lud16UsernameParam: registry.register('Lud16UsernameParam', lud16UsernameParam),
  Lud16CallbackQuery: registry.register('Lud16CallbackQuery', lud16CallbackQuerySchema),
  LightningAddressUpdateRequest: registry.register(
    'LightningAddressUpdateRequest',
    updateLightningAddressSchema,
  ),

  // ── Wallet ────────────────────────────────────────────────────────────
  WalletAddressUsernameParam: registry.register(
    'WalletAddressUsernameParam',
    walletAddressUsernameParam,
  ),
  LightningAddressMode: registry.register('LightningAddressMode', lightningAddressModeSchema),
  WalletAddressCreateRequest: registry.register(
    'WalletAddressCreateRequest',
    createWalletAddressSchema,
  ),
  WalletAddressUpdateRequest: registry.register(
    'WalletAddressUpdateRequest',
    updateWalletAddressSchema,
  ),
  WalletAliasProbeRequest: registry.register(
    'WalletAliasProbeRequest',
    probeAliasAddressSchema,
  ),
  WalletCardUpdateRequest: registry.register(
    'WalletCardUpdateRequest',
    updateWalletCardSchema.openapi({
      description:
        'Owner-scoped card update. Provide exactly one action: set `enabled` to enable or disable the card, or set `linkDefaultWallet` to true to bind it to the caller’s primary remote wallet.',
    }),
  ),

  // ── Users ─────────────────────────────────────────────────────────────
  UserRoleUpdateRequest: registry.register('UserRoleUpdateRequest', updateRoleSchema),

  // ── Settings ──────────────────────────────────────────────────────────
  SettingsBody: registry.register(
    'SettingsBody',
    // z.record() generates `additionalProperties` correctly but the generator
    // sometimes loses the key constraint, so we add an explicit description.
    settingsBodySchema.openapi({
      description:
        'Setting key/value pairs. Keys: lowercase letters, digits, hyphens, underscores; max 32 chars. Values: strings.',
    }),
  ),

  // ── Remote Connections ────────────────────────────────────────────────
  ExternalDeviceKeyParam: registry.register('ExternalDeviceKeyParam', externalDeviceKeyParam),
  RemoteCardCreateRequest: registry.register('RemoteCardCreateRequest', createRemoteCardSchema),

  // ── Remote Wallets ────────────────────────────────────────────────────
  RemoteWalletCreateRequest: registry.register(
    'RemoteWalletCreateRequest',
    createRemoteWalletSchema,
  ),
  RemoteWalletLncurlCreateRequest: registry.register(
    'RemoteWalletLncurlCreateRequest',
    createLncurlWalletSchema.openapi({
      description:
        'Provision a disposable LNCurl wallet. The server mints the NWC connection string; the new wallet becomes the default and inherits the previous wallet’s bindings.',
    }),
  ),
  RemoteWalletUpdateRequest: registry.register(
    'RemoteWalletUpdateRequest',
    // Same .refine() situation as updateCardDesignSchema: at-least-one-field
    // can't be expressed in JSON Schema, so we document it instead.
    updateRemoteWalletSchema.openapi({
      description:
        'Partial update for a remote wallet. At least one field must be present, otherwise the route returns 400.',
    }),
  ),
  RemoteWalletListQuery: registry.register('RemoteWalletListQuery', remoteWalletListQuerySchema),

  // ── Invoices ──────────────────────────────────────────────────────────
  InvoiceCreateRequest: registry.register('InvoiceCreateRequest', createInvoiceSchema),
  InvoiceClaimRequest: registry.register('InvoiceClaimRequest', claimInvoiceSchema),

  // ── JWT ───────────────────────────────────────────────────────────────
  JwtRequest: registry.register('JwtRequest', jwtRequestSchema),
  QrJwtGenerateRequest: registry.register('QrJwtGenerateRequest', qrJwtGenerateSchema),

  // ── Passkeys ──────────────────────────────────────────────────────────
  PasskeyRegistrationOptionsRequest: registry.register(
    'PasskeyRegistrationOptionsRequest',
    passkeyRegistrationOptionsRequestSchema.openapi({
      description:
        'Optional label for the passkey being created. The body may be omitted ' +
        'entirely — the label is only applied at verify time.',
    }),
  ),
  PasskeyRegistrationVerifyRequest: registry.register(
    'PasskeyRegistrationVerifyRequest',
    passkeyRegistrationVerifyRequestSchema.openapi({
      description:
        'Attestation result of a WebAuthn registration ceremony: the `challenge` ' +
        'echoed from the options step plus the browser `RegistrationResponseJSON` ' +
        'produced by @simplewebauthn/browser `startRegistration()`.',
    }),
  ),
  PasskeyAuthenticationVerifyRequest: registry.register(
    'PasskeyAuthenticationVerifyRequest',
    passkeyAuthenticationVerifyRequestSchema.openapi({
      description:
        'Assertion result of a WebAuthn authentication ceremony: the `challenge` ' +
        'echoed from the options step plus the browser `AuthenticationResponseJSON` ' +
        'produced by @simplewebauthn/browser `startAuthentication()`.',
    }),
  ),
  PasskeyNsecExportRequest: registry.register(
    'PasskeyNsecExportRequest',
    passkeyNsecExportRequestSchema.openapi({
      description:
        'Fresh EXPORT-flow WebAuthn assertion. Same wire shape as the login ' +
        'verify body, but the challenge must come from ' +
        '`POST /api/auth/passkey/nsec/export/options` — a LOGIN challenge can ' +
        'never unlock an export.',
    }),
  ),
  PasskeyCredentialUpdateRequest: registry.register(
    'PasskeyCredentialUpdateRequest',
    updatePasskeyCredentialSchema.openapi({
      description:
        'Rename payload. Only the label is mutable — key material, counter, and ' +
        'device metadata are fixed at registration.',
    }),
  ),

  // ── Account ───────────────────────────────────────────────────────────
  AccountLinkBeginRequest: registry.register(
    'AccountLinkBeginRequest',
    accountLinkBeginRequestSchema.openapi({
      description:
        'Which proof mechanism the client will use to demonstrate control of ' +
        'the other key: `nostr` (NIP-42-style signed event) or `passkey` ' +
        '(WebAuthn assertion).',
    }),
  ),
  AccountLinkVerifyRequest: registry.register(
    'AccountLinkVerifyRequest',
    accountLinkVerifyRequestSchema.openapi({
      description:
        'Proof of control of another Nostr key, discriminated by `method`. ' +
        '`nostr`: the challenge from link/begin plus a kind-22242 event signed ' +
        'by the key being linked (nonce echoed in a `challenge` tag). ' +
        '`passkey`: a LOGIN-flow WebAuthn assertion — challenge from ' +
        '`POST /api/auth/passkey/authentication/options` — proving control of ' +
        'a credential and thereby of the account that owns it.',
    }),
  ),
  AccountMergePreviewRequest: registry.register(
    'AccountMergePreviewRequest',
    accountMergePreviewRequestSchema.openapi({
      description:
        'The short-lived merge ticket returned by link/verify. Possession of ' +
        'the ticket IS the proof that the caller controls both accounts.',
    }),
  ),
  AccountMergeRequest: registry.register(
    'AccountMergeRequest',
    accountMergeRequestSchema.openapi({
      description:
        'Merge commit payload: the merge ticket from link/verify plus ' +
        '`mainPubkey`, which selects which of the combined identities becomes ' +
        'the surviving account’s primary.',
    }),
  ),
  UpdateIdentityRequest: registry.register(
    'UpdateIdentityRequest',
    // The .refine() (at least one of isPrimary/label) can't be expressed in
    // JSON Schema, so we ship the shape and document the constraint.
    updateIdentityRequestSchema.openapi({
      description:
        'Identity update. Provide at least one field, otherwise the route ' +
        'returns 400: `label` renames (null clears it), `isPrimary: true` ' +
        'promotes the identity to primary.',
    }),
  ),
}

// ── Inline response component schemas ─────────────────────────────────────
// Shapes the route handlers produce that aren't validated by Zod elsewhere.
// Kept inline so we don't pollute @lawallet-nwc/shared with response-only
// types — those schemas exist to validate inbound traffic.

export const SuccessEnvelope = registry.register(
  'SuccessEnvelope',
  z.object({ success: z.literal(true) }).openapi({
    description: 'Generic success envelope used by no-content-style endpoints.',
  }),
)

export const JwtResponse = registry.register(
  'JwtResponse',
  z
    .object({
      token: z.string(),
      expiresAt: z.string().datetime().optional(),
      pubkey: z.string().optional(),
      role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER']).optional(),
    })
    .openapi({
      description: 'JWT issued in exchange for a NIP-98 request, plus context for the client.',
    }),
)

export const CountResponse = registry.register(
  'CountResponse',
  z.object({ count: z.number().int().nonnegative() }).openapi({
    description: 'Generic single-count response shape.',
  }),
)

export const Lud16PayRequest = registry.register(
  'Lud16PayRequest',
  z
    .object({
      callback: z.string().url(),
      maxSendable: z.number().int(),
      minSendable: z.number().int(),
      metadata: z.string(),
      tag: z.literal('payRequest'),
      commentAllowed: z.number().int().optional(),
      allowsNostr: z.boolean().optional(),
      nostrPubkey: z.string().optional(),
    })
    .openapi({ description: 'LUD-16 pay request as defined by the LUD-06 spec.' }),
)

export const Lud16Callback = registry.register(
  'Lud16Callback',
  z
    .object({
      pr: z.string(),
      routes: z.array(z.unknown()).optional(),
      verify: z.string().url().optional(),
      successAction: z.unknown().optional(),
    })
    .openapi({ description: 'LUD-16 callback response containing the BOLT11 invoice.' }),
)

export const PasskeyOptionsResponse = registry.register(
  'PasskeyOptionsResponse',
  z
    .object({
      options: z.record(z.unknown()).openapi({
        description:
          'WebAuthn PublicKeyCredential options JSON — pass to ' +
          '@simplewebauthn/browser (`startRegistration` / `startAuthentication`) unchanged.',
      }),
    })
    .openapi({
      description:
        'Envelope for WebAuthn ceremony options. The `options` object follows the ' +
        'WebAuthn spec and is not modeled field-by-field here. Its challenge is ' +
        'stored server-side, is single-use, and expires after the ceremony timeout.',
    }),
)

export const PasskeySessionResponse = registry.register(
  'PasskeySessionResponse',
  passkeySessionResponseSchema.openapi({
    description:
      'Passkey session JWT + context, mirroring `POST /api/jwt`. The token carries ' +
      'the passkey claims (`amr: ["webauthn"]`, `cred`, `custody`, `auth_time`) ' +
      'required by the signer-key and session-refresh endpoints. `custody` is ' +
      '`managed` when the server custodies the account’s Nostr key, `linked` when ' +
      'the user brought their own signer.',
  }),
)

export const PasskeyCredentialSummary = registry.register(
  'PasskeyCredentialSummary',
  passkeyCredentialSummarySchema.openapi({
    description:
      'Non-sensitive passkey credential summary — never exposes the stored public ' +
      'key or signature counter.',
  }),
)

export const PasskeyCredentialListResponse = registry.register(
  'PasskeyCredentialListResponse',
  passkeyCredentialListResponseSchema.openapi({
    description:
      'The caller’s passkeys plus `hasManagedKey`: true when the server custodies ' +
      'this account’s Nostr key (passkey-native signup), false for linked accounts.',
  }),
)

// ── Account ───────────────────────────────────────────────────────────────

export const NostrIdentitySummary = registry.register(
  'NostrIdentitySummary',
  nostrIdentitySummarySchema.openapi({
    description:
      'One Nostr identity linked to an account. Exactly one identity per ' +
      'account is primary — it mirrors `User.pubkey` and is the account’s ' +
      'public identity.',
  }),
)

export const AccountSummaryResponse = registry.register(
  'AccountSummaryResponse',
  accountSummaryResponseSchema.openapi({
    description:
      'The caller’s own account: every linked Nostr identity (one primary), ' +
      'every passkey credential, and the managed-key custody state.',
  }),
)

export const AccountLinkBeginResponse = registry.register(
  'AccountLinkBeginResponse',
  accountLinkBeginResponseSchema.openapi({
    description:
      'Link-proof bootstrap. `nostr` method: `challenge` (opaque token to echo ' +
      'back at verify) + `nonce` (to embed in the signed kind-22242 event). ' +
      '`passkey` method: both fields are absent — the client uses the standard ' +
      'passkey authentication/options endpoint instead. `expiresIn` is seconds.',
  }),
)

export const AccountLinkVerifyResponse = registry.register(
  'AccountLinkVerifyResponse',
  accountLinkVerifyResponseSchema.openapi({
    description:
      'Outcome of a link proof. `linked: true` + `identity` when the pubkey was ' +
      'unowned and is now attached as a secondary identity. `linked: false` + ' +
      '`mergeTicket` + `otherAccount` when the key belongs to another account — ' +
      'nothing was written; the ticket gates the merge preview/commit flow.',
  }),
)

export const AccountMergePreviewResponse = registry.register(
  'AccountMergePreviewResponse',
  accountMergePreviewResponseSchema.openapi({
    description:
      'Read-only merge dry run: both accounts’ resource summaries, the ' +
      'collisions the merge would reconcile, and `blocked` — true while the ' +
      'absorbed account custodies a never-exported key.',
  }),
)

export const AccountMergeResponse = registry.register(
  'AccountMergeResponse',
  accountMergeResponseSchema.openapi({
    description:
      'Merge result: the surviving account id, the chosen primary pubkey, and ' +
      'counts of the resources re-parented from the absorbed account.',
  }),
)

export const Lud21Verify = registry.register(
  'Lud21Verify',
  z
    .object({
      status: z.enum(['OK', 'ERROR']),
      settled: z.boolean().optional(),
      preimage: z.string().nullable().optional(),
      pr: z.string().optional(),
      reason: z.string().optional(),
    })
    .openapi({ description: 'LUD-21 payment verification response.' }),
)
