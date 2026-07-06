import { z } from 'zod'

// ── NWC Listener contracts ──────────────────────────────────────────────────
//
// Cross-service surface between apps/web and apps/listener (the transport-only
// NWC relay bridge). Both sides import from here so the webhook payload, the
// /nwc/request proxy contract, and the /status shape can never drift.
// Web-API-facing schemas stay in ./schemas — this file is the listener pairing
// only (the webhook endpoint is deliberately not in the public OpenAPI spec).

/** Postgres NOTIFY channel fed by the trigger on "RemoteWallet". */
export const REMOTE_WALLET_CHANGED_CHANNEL = 'remote_wallet_changed'

/** Payload of a `remote_wallet_changed` notification. */
export const remoteWalletChangedSchema = z.object({
  id: z.string().min(1),
  op: z.enum(['INSERT', 'UPDATE', 'DELETE']),
})

/**
 * Webhook signature headers. The signature is
 * `sha256=<lowercase hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>`
 * and the timestamp is unix milliseconds; receivers reject when the clock
 * skew exceeds ±5 minutes.
 */
export const NWC_WEBHOOK_SIGNATURE_HEADER = 'x-lawallet-signature'
export const NWC_WEBHOOK_TIMESTAMP_HEADER = 'x-lawallet-timestamp'
export const NWC_WEBHOOK_SIGNATURE_PREFIX = 'sha256='
export const NWC_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000

/**
 * Notification kinds forwarded by the listener. `hold_invoice_accepted`
 * exists in NIP-47 / @getalby/sdk and is reserved here so enabling it later
 * isn't a contract break — v1 only subscribes to the first two.
 */
export const nwcNotificationTypeSchema = z.enum([
  'payment_received',
  'payment_sent',
  'hold_invoice_accepted',
])

const hex64 = z.string().regex(/^[0-9a-f]{64}$/i, 'Must be a 64-char hex string')

/**
 * Normalized payment details lifted from the NIP-47 notification. Everything
 * the wallet reported travels untouched in `transaction` — web owns all
 * business interpretation, the listener never filters fields.
 */
export const nwcWebhookPaymentSchema = z.object({
  paymentHash: hex64,
  preimage: z.string().regex(/^[0-9a-f]+$/i).optional(),
  amountMsats: z.number().int().nonnegative().optional(),
  feesPaidMsats: z.number().int().nonnegative().optional(),
  /** Unix seconds, per NIP-47 `settled_at`. */
  settledAt: z.number().int().optional(),
  invoice: z.string().optional(),
  description: z.string().optional(),
  /** Raw Nip47Transaction passthrough. */
  transaction: z.record(z.unknown()),
})

/**
 * Idempotency key shared by dedup storage and webhook deliveries:
 * `sha256("${walletId}|${notificationType}|${paymentHash}")`. The SDK's
 * notification callback never exposes the raw Nostr event id, and this key is
 * also stable across relays replaying the same notification as different
 * events.
 */
const nwcWebhookBase = z.object({
  eventKey: z.string().min(1),
  /** RemoteWallet.id the notification belongs to. */
  walletId: z.string().min(1),
  /** Unix ms when the listener first saw the event. */
  receivedAt: z.number().int(),
  /** True when synthesized by downtime catch-up instead of the live stream. */
  recovered: z.boolean().optional(),
})

export const nwcWebhookPayloadSchema = z.discriminatedUnion('type', [
  nwcWebhookBase.extend({
    type: z.literal('payment_received'),
    payment: nwcWebhookPaymentSchema,
  }),
  nwcWebhookBase.extend({
    type: z.literal('payment_sent'),
    payment: nwcWebhookPaymentSchema,
  }),
  nwcWebhookBase.extend({
    type: z.literal('listener_error'),
    /** Connection-level errors may not belong to a single wallet. */
    walletId: z.string().min(1).optional(),
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
    }),
  }),
  /**
   * The listener observed a wallet go unresponsive for a sustained window
   * WHILE its relays stayed connected — the signature of a disposable LNCurl
   * wallet whose provider destroyed it. Purely an observation: web decides
   * whether to archive it (only LNCurl-provider wallets are archived as DEAD).
   * `relaysConnected` is pinned to `true` so a network outage can never be
   * misread as death.
   */
  nwcWebhookBase.extend({
    type: z.literal('wallet_dead'),
    walletId: z.string().min(1),
    /** Seconds since the wallet last responded (event / proxied call / probe). */
    unresponsiveSeconds: z.number().int().nonnegative(),
    relaysConnected: z.literal(true),
  }),
])
export type NwcWebhookPayload = z.infer<typeof nwcWebhookPayloadSchema>

// ── POST {listener}/nwc/request — proxy NWC calls over the live pool ────────

export const nwcProxyMethodSchema = z.enum([
  'get_info',
  'get_balance',
  'pay_invoice',
  'make_invoice',
  'lookup_invoice',
  'list_transactions',
])
export type NwcProxyMethod = z.infer<typeof nwcProxyMethodSchema>

/**
 * Keys on `connectionString` (not walletId): the caller's NWC driver only
 * holds the wallet config, and the listener reads the exact same column from
 * the same Postgres — no new trust boundary. `walletId` is correlation-only.
 */
export const nwcProxyRequestSchema = z.object({
  connectionString: z.string().min(1),
  walletId: z.string().min(1).optional(),
  method: nwcProxyMethodSchema,
  /** Raw NIP-47 params — msat-speaking, passed to the SDK untouched. */
  params: z.record(z.unknown()).default({}),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
})
export type NwcProxyRequest = z.infer<typeof nwcProxyRequestSchema>

/**
 * `wallet_not_found` / `wallet_not_connected` / `timeout` / `relay_error` are
 * transport-level — web falls back to its direct NWC path. `wallet_error`
 * carries the NIP-47 error code from the wallet itself and is FINAL: a wallet
 * rejection must never be retried through a second transport.
 */
export const nwcProxyErrorCodeSchema = z.enum([
  'validation_error',
  'wallet_not_found',
  'wallet_not_connected',
  'wallet_error',
  'timeout',
  'relay_error',
])
export type NwcProxyErrorCode = z.infer<typeof nwcProxyErrorCodeSchema>

export const nwcProxyResponseSchema = z.union([
  z.object({ ok: z.literal(true), result: z.record(z.unknown()) }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: nwcProxyErrorCodeSchema,
      /** NIP-47 error code when `code === 'wallet_error'` (e.g. INSUFFICIENT_BALANCE). */
      walletErrorCode: z.string().optional(),
      message: z.string(),
    }),
  }),
])
export type NwcProxyResponse = z.infer<typeof nwcProxyResponseSchema>

// ── GET {listener}/status ────────────────────────────────────────────────────

export const listenerWalletStateSchema = z.enum([
  'connecting',
  'subscribed',
  'error',
  'closed',
])

export const listenerConnectionSchema = z.object({
  walletId: z.string(),
  walletName: z.string().nullish(),
  userId: z.string().nullish(),
  state: listenerWalletStateSchema,
  connected: z.boolean(),
  relayUrls: z.array(z.string()),
  /** ISO timestamps — null until the first event/error is seen. */
  lastEventAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** ISO timestamp of the last completed missed-event catch-up run. */
  lastCatchupAt: z.string().nullish(),
})
export type ListenerConnection = z.infer<typeof listenerConnectionSchema>

export const listenerRecentEventSchema = z.object({
  eventKey: z.string(),
  walletId: z.string(),
  /** RemoteWallet.name at read time (null if the wallet was deleted). */
  walletName: z.string().nullish(),
  type: z.string(),
  paymentHash: z.string().nullable(),
  amountMsats: z.number().int().nullable(),
  receivedAt: z.string(),
  webhookStatus: z.enum(['pending', 'delivered', 'failed']),
  /** True when the event came from downtime catch-up, not the live stream. */
  recovered: z.boolean().optional(),
})
export type ListenerRecentEvent = z.infer<typeof listenerRecentEventSchema>

export const listenerStatusResponseSchema = z.object({
  /** ISO timestamp of process start. */
  startedAt: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  relays: z.array(
    z.object({
      url: z.string(),
      connected: z.boolean(),
      walletCount: z.number().int().nonnegative(),
    }),
  ),
  connections: z.array(listenerConnectionSchema),
  counters: z.object({
    eventsReceived: z.number().int().nonnegative(),
    eventsDuplicate: z.number().int().nonnegative(),
    webhooksDelivered: z.number().int().nonnegative(),
    webhooksFailed: z.number().int().nonnegative(),
    /** Currently-undelivered webhooks still being retried (0 = all caught up). */
    webhooksPending: z.number().int().nonnegative().optional(),
    nwcRequests: z.number().int().nonnegative(),
    nwcRequestErrors: z.number().int().nonnegative(),
    eventsRecovered: z.number().int().nonnegative().optional(),
    catchupRuns: z.number().int().nonnegative().optional(),
    catchupErrors: z.number().int().nonnegative().optional(),
    deadProbesRun: z.number().int().nonnegative().optional(),
    deadProbesTimedOut: z.number().int().nonnegative().optional(),
    walletsDeclaredDead: z.number().int().nonnegative().optional(),
  }),
  recentEvents: z.array(listenerRecentEventSchema).max(100),
  /**
   * Sub-parts that failed to compute this cycle (e.g. `'recentEvents'` when the
   * DB feed query errored). The endpoint still returns 200 with everything
   * that DID compute — a single failing part never fails the whole status.
   */
  degraded: z.array(z.string()).optional(),
})
export type ListenerStatusResponse = z.infer<typeof listenerStatusResponseSchema>

/**
 * Shape returned by web's `GET /api/admin/listener/status` proxy. `disabled`
 * means the LISTENER_* env vars aren't set (the service is optional);
 * `unreachable` means configured but not answering — the admin page renders
 * an informative state for both instead of erroring.
 */
export const listenerStatusProxyResponseSchema = z.union([
  z.object({ state: z.literal('disabled') }),
  z.object({ state: z.literal('unreachable'), error: z.string() }),
  z.object({ state: z.literal('ok'), status: listenerStatusResponseSchema }),
])
export type ListenerStatusProxyResponse = z.infer<
  typeof listenerStatusProxyResponseSchema
>

// ── POST /api/settings/listener-probe — "Test connection" in the admin UI ──

export const listenerProbeRequestSchema = z.object({
  url: z.string().min(1),
  /** Omitted → the server falls back to the stored/env secret. */
  secret: z.string().min(1).optional(),
})
export type ListenerProbeRequest = z.infer<typeof listenerProbeRequestSchema>

/**
 * `unauthorized` (listener answered 401 — secret mismatch) is deliberately
 * distinct from `unreachable` (network/DNS/timeout) so the settings tab can
 * tell the operator exactly what to fix.
 */
export const listenerProbeResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    uptimeSeconds: z.number().int().nonnegative(),
    connections: z.number().int().nonnegative(),
    relays: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['unreachable', 'unauthorized', 'invalid_response', 'no_secret']),
    error: z.string(),
  }),
])
export type ListenerProbeResponse = z.infer<typeof listenerProbeResponseSchema>
