/**
 * Response/request types for the LaWallet REST API, hand-written from the
 * route implementations (the server validates all input with Zod — the SDK
 * ships types only, no runtime validation).
 */

/** Public subset of `GET /api/settings` (unauthenticated instance discovery). */
export interface PublicInstanceSettings {
  domain: string | null
  domain_verified: string | null
  /** Public origin the instance is reachable at. */
  endpoint: string | null
  subdomain: string | null
  hasRoot: boolean
  brand_theme: string | null
  brand_rounding: string | null
  community_name: string | null
  logotype_url: string | null
  isotypo_url: string | null
  community_cover_url: string | null
  maintenance_enabled: string | null
  lncurl_enabled: string | null
  lncurl_auto_create: string | null
  social_whatsapp: string | null
  social_telegram: string | null
  social_discord: string | null
  social_twitter: string | null
  social_website: string | null
  social_nostr: string | null
  social_email: string | null
  gtag_id: string | null
}

/** `GET /api/users/me` — fetching it materialises the user on first call. */
export interface CurrentUser {
  userId: string
  /** `username@domain` of the primary address, or null before one is claimed. */
  lightningAddress: string | null
  albySubAccount: {
    appId: string
    nwcUri: string
    username: string | null
  } | null
  nwcString: string
  nwcUpdatedAt: string | null
  effectiveNwcString: string | null
  primaryAddressMode: WalletAddressMode | null
  primaryUsername: string | null
  primaryRedirect: string | null
}

export type WalletAddressMode = 'IDLE' | 'ALIAS' | 'PROXY_ALIAS' | 'CUSTOM_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

/** One lightning address owned by the authenticated user. */
export interface WalletAddress {
  username: string
  mode: WalletAddressMode
  redirect: string | null
  /** The RemoteWallet this address is bound to (CUSTOM_NWC), or null. */
  remoteWalletId: string | null
  remoteWalletName: string | null
  isPrimary: boolean
  /** Server-derived effective capability for this address. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
}

/** Body for `POST /api/wallet/addresses`. Usernames are `[a-z0-9]{1,16}`, create-only. */
export interface CreateWalletAddressInput {
  username: string
  mode?: WalletAddressMode
}

/**
 * Body for `PUT /api/wallet/addresses/[username]`.
 * `mode: 'ALIAS'` requires `redirect` (`user@host`);
 * `mode: 'CUSTOM_NWC'` requires a caller-owned `remoteWalletId`.
 */
export interface UpdateWalletAddressInput {
  mode: WalletAddressMode
  redirect?: string | null
  remoteWalletId?: string | null
}

export interface UsernameAvailability {
  available: boolean
  username: string
}

/** Deferred-proxy settlement detail attached to a LUD-16 invoice, when routed via proxy. */
export interface AddressInvoiceProxy {
  id: string
  status: string
  destination: string
  feeBps: number
  grossAmountMsats: string
  serviceFeeMsats: string
  destinationAmountMsats: string
  forwardedAmountMsats: string | null
  routingFeeMsats: string | null
  sourcePaidAt: string | null
  forwardedAt: string | null
  receiptEventId: string | null
  receiptPublishedAt: string | null
  retryCount: number
  nextRetryAt: string
  leaseExpiresAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  attemptCount: number
  attempts: Array<Record<string, unknown>>
}

/** One received invoice on a lightning address (`GET .../invoices`). */
export interface AddressInvoice {
  id: string
  amountSats: number
  amountMsats: string
  bolt11: string
  description: string
  status: 'PENDING' | 'PAID' | 'EXPIRED'
  /** LUD-12 payer comment, when provided. */
  comment: string | null
  paymentHash: string
  createdAt: string
  paidAt: string | null
  expiresAt: string
  proxy: AddressInvoiceProxy | null
}

/** `POST /api/invoices` — a registration/address-purchase invoice to pay. */
export interface RegistrationInvoice {
  success: boolean
  message: string
  id: string
  bolt11: string
  paymentHash: string
  amountSats: number
  /** LUD-21 verify URL — poll it until `{ settled, preimage }`. */
  verify: string
  expiresAt: string
}

/** `POST /api/invoices` when the operator half-configured paid mode. */
export interface FreeRegistration {
  free: true
}

export interface ClaimInvoiceResult {
  success: boolean
  lightningAddress?: string
}

export type RemoteWalletType = 'NWC' | 'LND' | 'CLN' | 'BTCPAY'
export type RemoteWalletStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'DEAD'

/** One remote wallet (NWC connection) owned by the user. Secrets are never included. */
export interface RemoteWallet {
  id: string
  name: string
  type: RemoteWalletType
  status: RemoteWalletStatus
  isDefault: boolean
  createdAt: string
  updatedAt: string
  diedAt: string | null
  /** `'lncurl'` for a disposable server-minted wallet; null otherwise. */
  provider: 'lncurl' | null
  lncurlServerUrl: string | null
  receiveCapabilities?: {
    lud21: true
    nip57: boolean
    receiptPubkey: string | null
    reason: string | null
  }
  isOwner?: boolean
  ownerPubkey?: string | null
}

/** Body for `POST /api/remote-wallets`. NWC config is `{ connectionString }`. */
export interface CreateRemoteWalletInput {
  name: string
  type: RemoteWalletType
  config: unknown
  isDefault?: boolean
}

/** Body for `PATCH /api/remote-wallets/[id]` — at least one field required. */
export interface UpdateRemoteWalletInput {
  name?: string
  isDefault?: boolean
  status?: RemoteWalletStatus
}

/** LUD-06 pay-request returned by `GET /api/lud16/[username]`. */
export interface Lud06Response {
  tag: 'payRequest'
  callback: string
  minSendable: number
  maxSendable: number
  metadata: string
  commentAllowed?: number
  allowsNostr?: boolean
  nostrPubkey?: string
}

/** LUD-06 callback response — the bolt11 invoice to pay. */
export interface Lud06Invoice {
  pr: string
  verify?: string
  routes?: unknown[]
}

/** `/.well-known/nostr.json` (NIP-05). */
export interface Nip05Response {
  names: Record<string, string>
  relays?: Record<string, string[]>
}
