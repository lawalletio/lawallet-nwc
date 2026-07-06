# lawallet-listener: NWC Payment Listener

Transport-only NWC relay bridge. Lives in `apps/listener/`, runs as its own
container next to `lawallet-web`, and exists for one reason: `apps/web` is
built for lambda-style deployments (Vercel), where every NWC operation pays a
full relay-websocket handshake and nothing can *listen* for incoming events.
The listener has a real runtime, so it keeps the websockets open — both
directions get fast.

**Container**: `listener` (docker compose service) — published multi-arch image: `masize/lawallet-nwc-listener`
**Port**: `LISTENER_PORT` (default 4100)
**Storage**: service-owned `listener` schema in the shared Postgres

All business logic (payment matching, invoice state, receipts, LUD-22
operator webhooks) stays in `apps/web`. The listener moves bytes.

---

## Architecture

```
            ┌──────────────────────────── apps/listener ───────────────────────────┐
            │                                                                      │
Postgres ───┤ LISTEN remote_wallet_changed  ──►  reconcile pool (add/remove/rotate)│
 (shared)   │ SELECT ACTIVE NWC RemoteWallets                                      │
            │                                                                      │
NWC relays ─┤ one live NWCClient per wallet — subscribeNotifications               │
            │   payment_received / payment_sent                                    │
            │        │                                                             │
            │        ▼                                                             │
            │ dedup store (listener.processed_events)                              │
            │        │ new events only                                             │
            │        ▼                                                             │
apps/web ◄──┤ POST /api/webhooks/nwc   (HMAC-signed, retried, swept)               │
            │                                                                      │
apps/web ──►┤ POST /nwc/request        (pay_invoice etc. over the open socket —    │
            │                           the card-withdraw / LUD-16 fast path)      │
            │ GET  /status             (dashboard: relays, connections, events)    │
            │ GET  /health             (compose healthcheck)                       │
            └──────────────────────────────────────────────────────────────────────┘
```

A Prisma migration in `apps/web` installs a trigger on `"RemoteWallet"`:
every INSERT/UPDATE/DELETE fires `pg_notify('remote_wallet_changed',
'{"id": "...", "op": "..."}')` on COMMIT. The listener reconciles the
affected wallet; anything unparseable (or a LISTEN reconnect) triggers a full
reconcile, and a periodic full reconcile (default every 5 min) is the safety
net for missed notifications.

Cross-service schemas (webhook payload, `/nwc/request`, `/status`, header
names, channel name) live in **`packages/shared/src/listener.ts`** — both
sides import the same Zod definitions.

## Data (dedup + event feed)

The service bootstraps its own schema on startup (idempotent DDL, never part
of web's Prisma migrations):

```sql
CREATE SCHEMA IF NOT EXISTS listener;
CREATE TABLE IF NOT EXISTS listener.processed_events (
  event_key          text PRIMARY KEY,   -- sha256(walletId|type|payment_hash)
  wallet_id          text NOT NULL,
  notification_type  text NOT NULL,
  payment_hash       text,
  amount_msats       bigint,
  settled_at         timestamptz,
  payload            jsonb NOT NULL,     -- raw Nip47Transaction
  received_at        timestamptz NOT NULL DEFAULT now(),
  webhook_status     text NOT NULL DEFAULT 'pending',  -- pending|delivered|failed
  webhook_attempts   integer NOT NULL DEFAULT 0,
  webhook_last_error text,
  delivered_at       timestamptz
);
```

A companion `listener.wallet_cursors` table (wallet_id PK, last_seen_at)
anchors downtime catch-up, and `processed_events.recovered` flags synthesized
recoveries. The main table powers dedup (`INSERT … ON CONFLICT DO NOTHING` —
atomic claim),
the dashboard's recent-events feed, per-wallet `lastEventAt`, and webhook
delivery tracking. Retention: pruned hourly after `EVENT_RETENTION_DAYS`
(default 30); notifications older than retention−1 days are dropped before
storage so pruning can't reopen the dedup window.

The `event_key` is derived rather than a Nostr event id (the SDK's
notification callback doesn't expose one) — which also dedups a wallet
republishing the same notification as different Nostr events.

## Missed-event recovery (downtime catch-up)

NWC notification kinds (23196/23197) are **ephemeral** — relays don't store
them, and the SDK re-subscribes without `since` after a drop, so anything
published while the listener (or a relay link) was down would be lost. The
listener recovers those events with a **hybrid catch-up**, anchored on a
persisted per-wallet cursor (`listener.wallet_cursors.last_seen_at`):

1. **Wallet path (primary)** — NIP-47 `list_transactions` against the wallet's
   own ledger (paginated, settled-only, `incoming → payment_received`,
   `outgoing → payment_sent`). Works regardless of relay retention. Wallets
   answering `NOT_IMPLEMENTED` are remembered and skipped until the next full
   reconcile.
2. **Relay path (best-effort)** — a one-shot REQ with `since` for kinds
   23196/23197, decrypted via the client's negotiated encryption. Only pays
   off on NWC relays that retain ephemeral events; failures are skipped
   silently.

Catch-up runs on subscribe (startup / wallet added / rotation), when the 30s
connectivity watcher sees a relay link flip back up, and on a periodic safety
timer. Recovered events flow through the SAME dedup + webhook pipeline (the
derived event key makes replays free) and are flagged `recovered: true` in
the store, the `/status` feed and the webhook payload. Rules:

- **First sighting of a wallet seeds the cursor at `now` — no backfill.**
  Recovery covers downtime; it never imports pre-existing wallet history.
- Window: `from = max(cursor − CATCHUP_OVERLAP_SECONDS, now −
  CATCHUP_MAX_WINDOW_HOURS)`, `until = now` (after the live subscription is
  re-established, so the overlap is dedup-covered).
- The cursor only advances after a successful run — failures retry the same
  window next time. Live events also advance it (`GREATEST`, never backward).

## Dead-wallet detection (disposable LNCurl auto-archival)

Disposable LNCurl wallets are destroyed by their provider when they run out of
sats. The listener detects that and asks web to archive the row so a dead
wallet stops driving an endless reconnect loop. Detection is **transport-only**:
the listener observes and reports; **web decides and writes** (only
`provider: 'lncurl'` wallets ever become DEAD — a user's own NWC is never
auto-archived).

- **The rule:** a wallet is a candidate when it's `subscribed`, its relays are
  **currently connected** (so this is the wallet going silent, not a network
  outage), and it hasn't shown a sign of life for `DEAD_THRESHOLD_HOURS`
  (default 4). "Sign of life" = a received notification, a successful proxied
  `/nwc/request`, or a successful liveness probe.
- **Confirmation:** every `DEAD_PROBE_INTERVAL_MS` (default 15 min) the prober
  issues a cheap `get_info` to each candidate under `DEAD_PROBE_TIMEOUT_MS`.
  A reply — even a NIP-47 *error* reply — means the wallet is alive (the clock
  resets). Only a clean no-reply timeout **with relays still up** confirms
  death; a transport error is inconclusive and retried next sweep. Death is
  declared only after `DEAD_CONFIRMATION_PROBES` (default 3) such timeouts in a
  row — a single slow reply can never archive a live wallet. Total
  time-to-archive ≈ `DEAD_THRESHOLD_HOURS` + `(DEAD_CONFIRMATION_PROBES − 1) ×
  DEAD_PROBE_INTERVAL_MS` (~4h30m with the defaults).
- **Report → archive → reconcile:** on confirmation the listener POSTs a
  `wallet_dead` webhook (`{ walletId, unresponsiveSeconds, relaysConnected: true }`).
  Web sets `status = DEAD`, `diedAt = now`, `isDefault = false` (idempotent on
  `status = 'ACTIVE'`), which fires `remote_wallet_changed` → the listener
  reconciles the wallet out of the pool, ending the churn.
- Disable per deployment with `DEAD_WALLET_DETECTION_ENABLED=false`.

## HTTP API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | none | Liveness (+ informational `db` flag) |
| `GET /status` | Bearer | Relays, connections, counters, recent events. **Never 5xx** — each part degrades independently and a failed part is named in `degraded[]` |
| `POST /nwc/request` | Bearer | Proxy an NWC call over the pooled connection |

### Resilience

`GET /status` is built defensively: the relay/connection/counter view is
in-memory and always available, so a transient DB fault only empties the
`recentEvents` feed (and adds `"recentEvents"` to `degraded[]`) — it never 500s
the endpoint. The process also installs `unhandledRejection` /
`uncaughtException` backstops and a pg-pool `error` handler, so a relay
reconnect storm or a dropped idle DB connection is logged, not fatal — the
daemon stays up and answering.

Auth: `Authorization: Bearer <LISTENER_AUTH_SECRET>`, compared constant-time.

`POST /nwc/request` body (`nwcProxyRequestSchema`): `{ connectionString,
walletId?, method, params, timeoutMs? }` — keyed on the connection string the
caller already holds; `walletId` is correlation-only. Methods: `get_info`,
`get_balance`, `pay_invoice`, `make_invoice`, `lookup_invoice`,
`list_transactions`. Params and results are raw NIP-47 (msats) — unit
conversion stays in web's NWC driver. Request bodies over 64 KB are rejected
with `413`.

Error responses (`{ ok: false, error: { code, message, walletErrorCode? } }`):

| Code | HTTP | Meaning | Web fallback to direct? |
|------|------|---------|------------------------|
| `validation_error` | 400 | Bad request body | yes |
| `wallet_not_found` | 404 | No pooled connection for that string | yes |
| `wallet_not_connected` | 503 | Pool entry connecting / errored | yes |
| `wallet_error` | 502 | Wallet's own NIP-47 rejection | **no — final** |
| `timeout` | 504 | No reply within the window | yes (bounded by bolt11 single-settlement) |
| `relay_error` | 502 | Other transport failure | yes |

## Webhook contract (listener → web)

`POST {WEB_ORIGIN}/api/webhooks/nwc` with headers:

- `X-LaWallet-Timestamp`: unix milliseconds
- `X-LaWallet-Signature`: `sha256=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`

Web verifies constant-time (the `sha256=` prefix is optional on
verification) and rejects |now − timestamp| > 5 min. Payload is
`nwcWebhookPayloadSchema` — a discriminated union on `type`, all variants
sharing the base `{ eventKey, walletId, receivedAt (unix ms), recovered? }`:

- **`payment_received` / `payment_sent`** — add `payment: { paymentHash
  (64-hex), preimage?, amountMsats?, feesPaidMsats?, settledAt? (unix s),
  invoice?, description?, transaction }` where `transaction` is the raw
  `Nip47Transaction` passthrough (web owns all business interpretation).
- **`listener_error`** — `walletId` becomes optional (a connection-level
  error may not belong to a single wallet); adds `error: { code, message }`.
- **`wallet_dead`** — the listener saw a wallet go silent past the threshold
  while its relays stayed up (see "Dead-wallet detection"); adds
  `unresponsiveSeconds` and `relaysConnected: true`. Web archives it as DEAD
  only when it's an ACTIVE LNCurl-provider wallet.

Web is idempotent on `eventKey` and by invoice/wallet state; replays return
`{received: true}` without side effects. Responses: `200` ok · `401` bad
signature/skew · `400` schema mismatch · `404` integration disabled in
Settings. This endpoint is deliberately absent from the public OpenAPI spec —
it is an internal machine-to-machine contract.

Delivery: up to `WEBHOOK_MAX_ATTEMPTS` (default 5) inline attempts with
backoff (1s→2min); 2xx = delivered, 4xx≠429 = failed-for-now, 5xx/429/network
= retry. **Payment webhooks are never dropped.** Anything not delivered inline
is persisted `failed` with a `webhook_next_attempt_at` gate and picked up by a
sweep every 5 minutes — one attempt per event per sweep, with exponential
backoff (2min→1h cap) per event. There is **no attempt cap**: a payment
webhook keeps retrying until apps/web accepts it, so an arbitrarily long web
outage heals with zero data loss and no DLQ.

Observability: `/status` `counters.webhooksPending` is a live gauge of
currently-undelivered webhooks (0 = fully caught up). When the oldest
undelivered webhook has been stuck >10 minutes the sweep logs a
`webhook.backlog` warning (with the pending count, oldest age and target URL);
a successful late delivery logs `webhook.recovered`.

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Shared Postgres (same DB as web) | (required) |
| `LISTENER_PORT` | HTTP port | `4100` |
| `LISTENER_AUTH_SECRET` | Shared secret (HMAC + bearer), min 32 chars | (required) |
| `WEB_ORIGIN` | apps/web base URL for webhooks | (required) |
| `LOG_LEVEL` / `LOG_PRETTY` | Same conventions as web | `info` / `false` |
| `RECONCILE_INTERVAL_MS` | Full-reconcile safety net | `300000` |
| `NWC_REQUEST_TIMEOUT_MS` | Default /nwc/request timeout | `30000` |
| `WEBHOOK_MAX_ATTEMPTS` | Inline delivery attempts | `5` |
| `EVENT_RETENTION_DAYS` | Dedup/feed retention | `30` |
| `CATCHUP_ENABLED` | Missed-event recovery on/off | `true` |
| `CATCHUP_MAX_WINDOW_HOURS` | Furthest back a catch-up looks | `24` |
| `CATCHUP_OVERLAP_SECONDS` | Overlap subtracted from the cursor | `300` |
| `CATCHUP_INTERVAL_MS` | Periodic safety catch-up (0 disables) | `900000` |
| `DEAD_WALLET_DETECTION_ENABLED` | Archive unresponsive disposable wallets as DEAD | `true` |
| `DEAD_THRESHOLD_HOURS` | Silence (relays up) before a wallet is declared dead | `4` |
| `DEAD_PROBE_INTERVAL_MS` | How often the dead-wallet prober sweeps | `900000` |
| `DEAD_PROBE_TIMEOUT_MS` | Per-probe `get_info` timeout (< `NWC_REQUEST_TIMEOUT_MS`) | `10000` |
| `DEAD_CONFIRMATION_PROBES` | Consecutive failing probes required before archiving (guards against one transient slow reply) | `3` |

Web's side of the pairing: `LISTENER_URL` + the same `LISTENER_AUTH_SECRET`
(+ optional `LISTENER_REQUEST_TIMEOUT_MS`, default 10000). All optional —
web runs fully without the listener.

## Settings-based configuration (web side)

The pairing can also be managed at runtime in **Admin → Settings → NWC
Services**, stored in the Settings DB as `listener_enabled` /
`listener_url` / `listener_auth_secret`. `apps/web/lib/listener-config.ts`
resolves the EFFECTIVE config on every use:

- URL/secret: the DB value wins when set (empty = unset), else the
  `LISTENER_*` env var.
- `listener_enabled` row `'true'` → on (iff url+secret resolve); `'false'`
  → force-off even over env; **no row** → *env-auto*: on iff both env vars
  exist (Docker Compose / Umbrel / Start9 zero-config).
- Settings DB unreachable → env-only fallback; stored secrets under 32
  chars are ignored.

The toggle gates everything: the webhook receiver (404 when off), the driver
fast-path bridge, the status proxy, and the "NWC Listener" admin menu item.
`POST /api/settings/listener-probe` (settings-write gated) implements the
tab's **Test connection** button — it calls the listener's authenticated
`/status` and distinguishes `unauthorized` (secret mismatch) from
`unreachable` (network).

## Hosting the listener separately (Vercel / Netlify deployments)

Serverless hosts can't run a long-lived websocket process, so deploy the
listener container elsewhere and paste its URL + shared secret into
**Settings → NWC Services**:

- **Railway** — New Project → Deploy from GitHub repo → set *Dockerfile
  Path* to `apps/listener/Dockerfile` (root directory = repo root) → add the
  env vars above → generate a public domain. Healthcheck: `/health`.
- **Render** — Web Service from the repo, environment *Docker*, same
  Dockerfile path + env vars.
- **Fly.io** — `fly launch --dockerfile apps/listener/Dockerfile`, set env
  via `fly secrets set`, expose port 4100.
- **Any VPS** — `docker build -f apps/listener/Dockerfile .` and run with
  the env vars; put TLS in front if web connects over the public internet.

Requirements: the listener must reach the same Postgres as web (hosted
Postgres like Neon/Supabase/Railway works) and the Nostr relays; web must
reach the listener URL; the listener must reach `WEB_ORIGIN`. Operator-facing
walkthrough: `apps/docs/content/docs/deploy/listener-setup.mdx` (docs site
`/docs/deploy/listener-setup`).

## Operations

- **Boot order**: after Postgres answers, the listener waits (up to ~2 min)
  for web's `prisma migrate deploy` to create the `"RemoteWallet"` table
  before starting the pool — on fresh installs both containers start
  together and the schema doesn't exist yet (`waitForSchema` in `src/db.ts`).
- **Dev**: `pnpm dev:setup` provisions `apps/listener/.env.local` per
  worktree; `pnpm dev:listener` runs it (tsx watch). The admin dashboard at
  `/admin/listener` shows live state (SSE-refreshed).
- **Compose**: the `listener` service starts automatically with
  `docker compose up`, healthchecked via `GET /health`. Web has no
  `depends_on` — the listener is intentionally optional.
- **Shutdown**: SIGTERM closes the HTTP server, the LISTEN client, every
  NWC client, and the pg pool (10s force-exit guard).

## Failure modes

- **Listener down** → web fully functional, degraded to per-request relay
  handshakes (the NWC driver falls back automatically); no incoming
  notifications until restart. Dashboard shows `unreachable`.
- **Web down** → events keep landing in the dedup store; the sweep delivers
  them when web returns.
- **Relay down / listener down** → the SDK's internal loop resubscribes (1s
  cadence) and the hybrid catch-up recovers events missed during the gap
  (see "Missed-event recovery"): the wallet's `list_transactions` ledger is
  the source of truth, with a relay `since`-replay as best-effort extra.
  `lastEventAt` / `lastCatchupAt` in `/status` make gaps visible.
- **Bad wallet row** (malformed connection string) → skipped with a warning;
  never takes down the pool.
