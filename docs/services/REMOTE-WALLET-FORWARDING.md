# RemoteWallet receive forwarding

RemoteWallet receive forwarding is an owner-scoped action in `lawallet-web`.
It is separate from the operator-managed LUD-16 deferred proxy: any
authenticated user can attach one `FORWARD` action to an active NWC wallet
whose mode is `SEND_RECEIVE`.

## Money model

Each immutable configuration revision snapshots a percentage fee, a fixed
base fee and one or more Lightning Address destinations. Destination
allocations must total exactly 10,000 bps. Defaults are 50 bps (0.5%) and one
sat.

All calculations use millisatoshis:

```text
retained = ceil(gross * feeBps / 10,000) + baseFeeMsats
target   = max(0, gross - retained)
```

The target is split with deterministic largest-remainder allocation, so the
legs always sum exactly to the target. Before requesting each destination
invoice, the engine reserves **1% + 1 sat** from that leg (the percentage is
rounded up to whole sats). The invoice is requested for the remainder. The
planned reserve, actual routing fee, unused reserve and any fee overage are
stored separately. A destination invoice may be up to 10 sats below that
reduced request, never above it; this separate shortfall remains in the wallet
and is recorded on the leg.

Routing usually costs less than the reserve. The leftover is still owed to the
destination, so it is **carried forward as pending balance** rather than kept
in the source wallet: on completion the engine parks it on a *residual* leg —
one per destination per action — which the next batch to that destination picks
up. A residual leg is real pending balance and shows up in the pending amount,
but it never holds the originating receipt open, so a forward still reports
`COMPLETED` (and fires its notification and zap receipt) as soon as the
destination has been paid. If no further payment ever arrives, the residual
simply keeps accumulating until it is large enough to send.

## Durable workflow

The listener webhook first inserts a receipt keyed by
`(walletId, paymentHash)`, preserving its listener `eventKey`, and only then
returns. Paused and pre-activation events are ignored. Events whose amount is
missing are retained as `BLOCKED` records and recovered with `lookup_invoice`.
This capture does not replace normal LaWallet `Invoice` settlement; both
paths continue for known invoices.

Workers claim receipts with short per-wallet action leases using `FOR UPDATE
SKIP LOCKED`. Only one receipt from a RemoteWallet can be processed at a time,
even with multiple workers. Each destination attempt is persisted before
payment and uses the listener journal request ID:

```text
sha256(walletId|destinationPaymentHash|legId|attemptNo)
```

An ambiguous `PENDING` or `UNKNOWN` result is never paid again until a
listener journal result, `payment_sent` notification, or wallet lookup proves
success or rejection/expiry. Legs run sequentially within a receipt; separate
receipts may run concurrently. Succeeded legs are never reversed.

Database triggers serialize ownership of every destination payment hash
across RemoteWallet legs and the operator LUD-16 proxy, preventing the same
invoice from satisfying two forwarding obligations.

## Configuration and retries

Changing destinations or fees is atomic and does not require pausing the
action. It is rejected while any attempt is `PENDING`/`UNKNOWN`. Paid legs stay
immutable; unpaid legs are superseded and the remaining amount is allocated
under the new revision. A revision is rejected if its new target is less than
the amount already paid.

Disabling or archiving a wallet pauses its action. Automatic retries use the
listener's existing ten-minute reconciliation wake-up. Manual retry only
advances safe `READY`, `REJECTED`, or `EXPIRED` legs; it cannot re-dispatch an
uncertain payment.

A terminal `INSUFFICIENT_BALANCE` response is safe to retry. The next attempt
requests a fresh, lower invoice and doubles the previous routing reserve. A
`PENDING` or `UNKNOWN` result never changes the reserve or creates another
payment.

## Owner API and live UI

- `GET|PUT|PATCH /api/remote-wallets/{id}/receive-action`
- `POST /api/remote-wallets/{id}/receive-action/force` adelanta todos los
  recibos pendientes y despierta el reconciliador inmediatamente; no reemplaza
  attempts con resultado `PENDING` o `UNKNOWN`.
- `GET /api/remote-wallets/{id}/forwarding-receipts`
- `GET /api/remote-wallets/{id}/forwarding-activity`
- `GET /api/remote-wallets/{id}/forwarding-receipts/{receiptId}`
- `POST /api/remote-wallets/{id}/forwarding-receipts/{receiptId}/retry`

Every route resolves the authenticated account and returns 404 for a wallet
or receipt owned by someone else. The wallet and admin details share an
Overview, Payments received, Forwarding, and receipt-audit interface. Payments
received combines ordinary incoming NWC transactions with forwarding receipts,
deduplicated by payment hash, while Forwarding shows the attempt/retry journal. The
payload-free `remote-wallet-forwarding:updated` SSE event invalidates only
owner-scoped API queries; no user data is broadcast in the event.
Payments and attempt activity use independent cursor pagination.

## Operator and wallet-owner runbook

### Prerequisites

1. Run the additive Prisma migrations before enabling an action:

   ```bash
   pnpm --filter @lawallet-nwc/web exec prisma migrate deploy
   ```

2. Keep the NWC Listener enabled, configured with the same vault secret as
   the web service, and healthy. The listener is the authoritative incoming
   settlement signal. It stores the receipt before the webhook response, then
   wakes the forwarding and notification reconcilers. Its recurring sweep
   provides recovery after a restart or missed relay notification.
3. Choose an active NWC RemoteWallet with `SEND_RECEIVE` capability. A wallet
   which cannot receive, pay invoices, and resolve a destination safely stays
   usable as a wallet but cannot enable this action.
4. Create a **Forward on receive** action in the RemoteWallet detail (or use
   **Create proxy wallet**), select one or more destinations, and make their
   allocations add up to exactly 10,000 bps. The action starts enabled only
   when the user chooses to enable it; existing wallets are not opted in by a
   migration.

The UI is the preferred configuration surface. Integrations can use the
owner-scoped endpoints listed above. A `PUT` configuration body contains
`feeBps`, `baseFeeSats`, `enabled`, and
`destinations: [{ address, allocationBps }]`. Percentage fees are capped at
10%. A `PATCH` body of `{ "enabled": false }` pauses the action; `{ "enabled":
true }` resumes it and immediately wakes a safe reconciliation pass.

### How to operate a pending balance

`Force Forward` does not invent a new payment or bypass safety checks. It
moves all open receipts for that wallet to the front of the safe work queue
and switches the UI to **Forwarding**. It can be used after adding funds, a
destination recovery, or an operator intervention. The worker still refuses
to replace a `PENDING` or `UNKNOWN` attempt until its original outcome has
been proven.

Small incoming receipts are intentionally kept in the pending balance. When
the accumulated amount cannot pay a destination after the routing reserve,
the affected receipt is shown as `BLOCKED` with the reason:

> Pending amount is too small to forward. It will be retried when more funds arrive.

This is a recoverable blocked state, not a loss of funds. It remains eligible
as later receipts increase the pending amount. The next safe attempt uses the
full pending amount for its destination instead of sending a succession of
uneconomic micro-payments. The receipt detail shows the retained fee, planned
routing reserve, actual fee, unused reserve, destination shortfall, and the
last error so an operator can distinguish this case from a real payment
failure.

For a delivery failure, first inspect **Forwarding** and the receipt detail:

- `RECEIVED` / `FORWARDING` means the durable worker has it queued or leased.
- `PARTIAL` means at least one destination was paid. Paid legs are final; only
  unpaid legs are retried.
- `BLOCKED` contains the actionable last error and stays visible in the
  pending balance. This includes amounts that are too small and recoverable
  destination failures.
- `COMPLETED` means every leg succeeded. `RETAINED` means no positive amount
  remained after the configured entry fee.
- `PENDING` and `UNKNOWN` attempts deliberately block replacement payment
  attempts. Resolve them through the listener journal, `payment_sent`, or a
  wallet lookup; never retry by hand just to make the status disappear.

`Retry` on an individual receipt only advances safe, unpaid legs. It is useful
for a corrected address or a rejected/expired invoice. A configuration change
creates a new immutable revision: paid legs remain attached to their original
revision and unpaid legs are superseded then redistributed. The change is
rejected while a payment result is uncertain, or if it would make the new
target lower than what has already been sent.

### Wallet notifications

Every RemoteWallet can add multiple outbound notification channels from its
detail page. They are separate from forwarding and may be paused/resumed
independently:

- **Webhook** — HTTPS only, no embedded credentials, DNS-pinned after a
  public-address check to prevent SSRF and DNS rebinding. LaWallet posts JSON
  with `Idempotency-Key` (the deterministic attempt request ID) and
  `X-LaWallet-Event` (the stable event key). A non-2xx response is retried.
  An outcome which may have written bytes but cannot be verified becomes
  `UNKNOWN` and is never automatically sent again.
- **Nostr** — set an event kind, recipient `p` tag, relays, content template,
  and optional NIP-44 encryption. The same signed event is used for retries,
  which makes relay publication safe to retry. Templates support
  `{{payload}}`, `{{action}}`, `{{eventKey}}`, `{{walletId}}`,
  `{{walletName}}`, `{{paymentHash}}`, and `{{amountMsats}}`.

Both channels support `RECEIVED` and `FORWARDED` actions. The JSON payload is
versioned and includes the action, a wallet id/name/user id, a stable event
key, and the action-specific data. The delivery journal persists every
attempt, response/error, Nostr event id, and timestamps. It uses leases and a
deterministic request ID to prevent concurrent double delivery. After a retry
or state change the `remote-wallet-notifications:updated` SSE event refreshes
only owner-scoped client queries.

Notification APIs:

- `GET|POST /api/remote-wallets/{id}/notifications`
- `PATCH /api/remote-wallets/{id}/notifications/{notificationId}`
- `GET /api/remote-wallets/{id}/notification-deliveries?cursor=&limit=`
- `POST /api/remote-wallets/{id}/notification-deliveries/{deliveryId}/retry`

### Public Lightning and Nostr protocols

Local RemoteWallet-backed addresses expose LUD-21 payment verification. They
also advertise and accept NIP-57 zap requests only when the listener is
enabled and the instance receipt signer is available; this avoids promising a
zap receipt that cannot be observed and published. The receipt signer is
created at install, can be rotated by the operator, and is published as the
NIP-05 root-domain identity (`/.well-known/nostr.json?name=_`). It is shown as
an `npub` in the wallet UI, while NIP-05 correctly returns its hex public key.

For every normal address, NIP-05 resolves the public key of the address owner
(preferring that account's primary Nostr identity). LUD-16 callback validation
uses the same resolved identity, so a valid NIP-57 `p` tag cannot fail due to
an old `npub`-formatted development seed. Malformed zap requests return a
validation error instead of an internal error.

`/.well-known/nostr.json`, `/.well-known/lnurlp/{username}`, the LUD-16
callback, and the LUD-21 verifier are intentionally public and reply with
`Access-Control-Allow-Origin: *` plus read-only preflight headers. Do not add
authentication or origin restrictions to these protocol endpoints.

### Development and diagnosis

The Codex session hook at `.codex/hooks/start-dev-server.sh` starts the
worktree-local web process and listener on session start without killing an
existing process. It honours `WEB_PORT` and `LISTENER_PORT` from
`.env.development.local`; logs go to `.dev/codex-web.log` and
`.dev/codex-listener.log`. It is safe to rerun:

```bash
bash .codex/hooks/start-dev-server.sh
curl -fsS "http://127.0.0.1:${LISTENER_PORT:-4196}/health"
```

For a production incident, check listener health first, then the receipt's
last error and the attempt journal. Do not delete receipts, legs, or journal
rows to force a retry: those records are the idempotency boundary. Use the
safe Retry/Force Forward controls after the underlying wallet balance or
destination issue is corrected.
