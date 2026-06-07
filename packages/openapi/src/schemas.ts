import {
  cardListQuerySchema,
  claimActivationTokenSchema,
  claimInvoiceSchema,
  createActivationTokenSchema,
  createCardDesignSchema,
  createCardSchema,
  createInvoiceSchema,
  createRemoteCardSchema,
  createWalletAddressSchema,
  externalDeviceKeyParam,
  idParam,
  jwtRequestSchema,
  qrJwtGenerateSchema,
  lightningAddressModeSchema,
  lud16CallbackQuerySchema,
  lud16UsernameParam,
  otcParam,
  payActionQuerySchema,
  scanCardQuerySchema,
  settingsBodySchema,
  updateCardDesignSchema,
  updateLightningAddressSchema,
  updateRoleSchema,
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
  CardCreateRequest: registry.register('CardCreateRequest', createCardSchema),
  CardListQuery: registry.register('CardListQuery', cardListQuerySchema),
  ScanCardQuery: registry.register('ScanCardQuery', scanCardQuerySchema),
  PayActionQuery: registry.register('PayActionQuery', payActionQuerySchema),
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

  // ── Invoices ──────────────────────────────────────────────────────────
  InvoiceCreateRequest: registry.register('InvoiceCreateRequest', createInvoiceSchema),
  InvoiceClaimRequest: registry.register('InvoiceClaimRequest', claimInvoiceSchema),

  // ── JWT ───────────────────────────────────────────────────────────────
  JwtRequest: registry.register('JwtRequest', jwtRequestSchema),
  QrJwtGenerateRequest: registry.register('QrJwtGenerateRequest', qrJwtGenerateSchema),
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
