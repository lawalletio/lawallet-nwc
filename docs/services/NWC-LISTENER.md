# lawallet-listener: NWC Payment Listener

Transport-only NWC relay bridge. Lives in `apps/listener/`, runs as its own
container next to `lawallet-web`, and exists for one reason: `apps/web` is
built for lambda-style deployments (Vercel), where every NWC operation pays a
full relay-websocket handshake and nothing can *listen* for incoming events.
The listener has a real runtime, so it keeps the websockets open — both
directions get fast.

**Container**: `listener` (docker compose service)
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

One table powers dedup (`INSERT … ON CONFLICT DO NOTHING` — atomic claim),
the dashboard's recent-events feed, per-wallet `lastEventAt`, and webhook
delivery tracking. Retention: pruned hourly after `EVENT_RETENTION_DAYS`
(default 30); notifications older than retention−1 days are dropped before
storage so pruning can't reopen the dedup window.

The `event_key` is derived rather than a Nostr event id (the SDK's
notification callback doesn't expose one) — which also dedups a wallet
republishing the same notification as different Nostr events.

## HTTP API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | none | Liveness (+ informational `db` flag) |
| `GET /status` | Bearer | Relays, connections, counters, recent events |
| `POST /nwc/request` | Bearer | Proxy an NWC call over the pooled connection |

Auth: `Authorization: Bearer <LISTENER_AUTH_SECRET>`, compared constant-time.

`POST /nwc/request` body (`nwcProxyRequestSchema`): `{ connectionString,
walletId?, method, params, timeoutMs? }` — keyed on the connection string the
caller already holds; `walletId` is correlation-only. Methods: `get_info`,
`get_balance`, `pay_invoice`, `make_invoice`, `lookup_invoice`,
`list_transactions`. Params and results are raw NIP-47 (msats) — unit
conversion stays in web's NWC driver.

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

Web verifies constant-time and rejects |now − timestamp| > 5 min. Payload is
`nwcWebhookPayloadSchema` — a union of `payment_received` / `payment_sent`
(with the raw transaction passthrough) and `listener_error`. Web is
idempotent on `eventKey` and by invoice state; replays return `{received:
true}` without side effects. This endpoint is deliberately absent from the
public OpenAPI spec — it is an internal machine-to-machine contract.

Delivery: up to `WEBHOOK_MAX_ATTEMPTS` (default 5) inline attempts with
backoff (1s→2min); 2xx = delivered, 4xx≠429 = permanent for the round,
5xx/429/network = retry. A sweep every 5 minutes re-dispatches undelivered
events (attempt cap 25) — this is how an hour of web downtime heals without
a DLQ.

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

Web's side of the pairing: `LISTENER_URL` + the same `LISTENER_AUTH_SECRET`
(+ optional `LISTENER_REQUEST_TIMEOUT_MS`, default 10000). All optional —
web runs fully without the listener.

## Operations

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
- **Relay down** → the SDK's internal loop resubscribes (1s cadence);
  notifications published while disconnected are lost unless the relay
  replays them — `lastEventAt` in `/status` makes gaps visible. A
  `list_transactions` catch-up is deliberately out of scope (transport-only).
- **Bad wallet row** (malformed connection string) → skipped with a warning;
  never takes down the pool.
