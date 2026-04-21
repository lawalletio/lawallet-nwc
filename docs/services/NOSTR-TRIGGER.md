# nostr-trigger: Real-time NWC Listener + Trigger Engine

## Brief (read this first)

`@lawallet-nwc/nostr-trigger` is a Bun + TypeScript backend service that keeps persistent WebSocket connections to Nostr relays open and reacts to NIP-47 Nostr Wallet Connect payment notifications in real time.

`apps/web` runs on stateless Next.js workers and cannot hold long-lived relay subscriptions. `nostr-trigger` fills that gap: it is the only process in the stack that owns stateful Nostr connections.

Given N NWC connections that may share relay URLs, it opens **one WebSocket per unique relay** and multiplexes per-NWC subscriptions as separate REQ frames over that socket, using `nostr-tools` `SimplePool`. Incoming kind-23196 / 23197 notifications are decrypted (NIP-44 with NIP-04 fallback), deduplicated by event `id` via a Redis `SET NX`, persisted to a per-`(nwc, relay)` cursor so restarts resume without loss, then fan-out to two pipelines:

- **Webhook dispatcher** — BullMQ queue on Redis delivers each notification to each NWC's configured URLs with exponential backoff + ±20% jitter, an `Idempotency-Key: <event-id>` header and an HMAC-SHA256 signature, and a dead-letter audit entry after all attempts are exhausted.
- **NIP-57 zap publisher** — builds and signs kind-9735 zap receipts with the service's LNURL nsec and fans out to the union of the zap request's own relays and the configured defaults.

The control plane is dual:

- **HTTP (Hono)** — bearer-token-authenticated REST at `/api/v1/*` for CRUD on NWC connections, relays, webhook endpoints, admins, and runtime status.
- **Nostr** — the service holds its own nsec; authorized pubkeys (resolved from the shared `User` table's `ADMIN` role **or** a `NostrTriggerAdmin` allowlist) send NIP-44-encrypted kind-4 DMs whose payloads mirror the HTTP command surface. The service replies with encrypted DMs.

State split: configs, audit log, and zap ledger live in the shared Postgres (via `@lawallet-nwc/prisma`); dedup set, BullMQ retry queue, and per-subscription `since` cursors live in Redis.

---

## Overview

| | |
|---|---|
| **Container** | `nostr-trigger` |
| **Runtime** | Bun 1.x |
| **Language** | TypeScript (ESM, strict) |
| **Port** | 3010 |
| **Postgres** | shared with `apps/web` via `@lawallet-nwc/prisma` |
| **Redis** | required — BullMQ, dedup set, cursors |
| **Status** | Initial implementation — the runtime, HTTP/Nostr control planes, webhook + zap pipelines are all in place |

---

## Architecture

```
                        apps/nostr-trigger (Bun runtime)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Hono HTTP /api/v1     NostrControlPlane (kind-4 NIP-44 DM listener)   │
  │         │                          │                                   │
  │         └──────────┬───────────────┘                                   │
  │                    ▼                                                   │
  │          CommandHandlers  ── reads/writes ──►  Postgres (shared)       │
  │                    │                           - NwcConnection         │
  │                    ▼                           - WebhookEndpoint       │
  │          ConnectionManager                     - NostrTriggerAdmin     │
  │          RelayPool (SimplePool)                - AuditEvent            │
  │          - 1 WS per relay URL                  - ZapReceiptLedger      │
  │          - many REQ subs                                               │
  │                    │                                                   │
  │   kind-23196/7 ───►│ EventIngest                                       │
  │                    │  • verify + decrypt (NIP-44/NIP-04)               │
  │                    │  • dedup via Redis SET NX (TTL 72h)               │
  │                    │  • persist cursor (nwc,relay) → Redis             │
  │                    │  • append audit row → Postgres                    │
  │                    ▼                                                   │
  │           ┌────────┴─────────┐                                         │
  │           ▼                  ▼                                         │
  │  WebhookDispatcher    ZapReceiptPublisher                              │
  │  (BullMQ on Redis)    (nostr-tools finalizeEvent + SimplePool.publish) │
  └────────────────────────────────────────────────────────────────────────┘
                 │                                 │
                 ▼                                 ▼
        configured webhooks                 fan-out relays
```

## Responsibilities

- Subscribe to NIP-47 (NWC) notification events for every enabled `NwcConnection`, multiplexing over shared relay sockets.
- Decrypt (NIP-44 first, NIP-04 fallback) and verify every inbound event.
- Dedup by `event.id` so the same event arriving over multiple relays produces one downstream effect.
- Persist a `(nwc, relay) → since` cursor so restarts resume from where we left off.
- Deliver a signed webhook for every notification to every matching `WebhookEndpoint`, with durable retry and DLQ via BullMQ.
- Sign + publish NIP-57 kind-9735 zap receipts on demand (manual `POST /api/v1/zap/publish`, or automatic from the ingest pipeline when the notification payload matches a stored zap request).
- Expose CRUD for all configuration over both HTTP (secret-token auth) and encrypted Nostr DMs (pubkey-based auth).
- Write an audit row for every state-changing action, regardless of source.

### Non-responsibilities

- Paying invoices (the NWC service does that).
- Storing user/card data (lives in `apps/web`).
- Frontend UI (an admin UI in `apps/web` is follow-up work).
- Horizontal scale-out (single instance for now; BullMQ + Redis dedup keeps the door open).

---

## Independence

- **Own Redis** — dedicated, not shared with `apps/web`'s optional Upstash for rate-limiting.
- **Shared Postgres** — via `@lawallet-nwc/prisma`, because `NwcConnection.ownerUserId` references `User.id` and admin auth checks `User.role`.
- **No inbound calls from other services** — `apps/web` can manage `nostr-trigger` over its authenticated HTTP API; `nostr-trigger` never calls `apps/web`.
- **Secrets at rest** — `NwcConnection.clientSecret` and `WebhookEndpoint.secret` are AES-256-GCM encrypted with `NT_MASTER_KEY` before hitting the database and decrypted on use only.

---

## Data flow: notification → webhook

1. `ConnectionManager.start()` loads all enabled `NwcConnection` rows and opens one REQ per row with filter `{kinds:[23196,23197], authors:[walletPubkey], #p:[clientPubkey], since:cursor-60}`.
2. A matching event lands.
3. `handleNwcNotification` verifies the signature, atomically claims the event id in Redis (TTL 72h). If the `SET NX` fails, this is a duplicate — drop.
4. Decrypt `event.content` with the stored `clientSecret` (AES envelope decrypted on use). Try NIP-44 first, fall back to NIP-04.
5. Insert an `AuditEvent` row recording `{source:"runtime", action:"nwc_notification"}`.
6. Advance the Redis cursor for `(nwcId, relayUrl)` to `max(cursor, event.created_at)`.
7. For every enabled `WebhookEndpoint` whose `eventKinds` matches (or is empty), enqueue a BullMQ job.
8. Worker picks it up, POSTs JSON to the endpoint with headers:
   - `Content-Type: application/json`
   - `Idempotency-Key: <event_id>`
   - `X-LaWallet-Signature: sha256=<hex>` (HMAC of the body with the endpoint's secret)
   - `X-LaWallet-Event-Kind: <kind>`
   - `X-LaWallet-Nwc-Id: <nwc-connection-id>`
   - `User-Agent: lawallet-nostr-trigger/<version>`
9. Classification:
   - 2xx → success.
   - 4xx except 408/429 → terminal, no retry, audit row written.
   - 5xx / 408 / 429 / network / timeout → retryable.
10. Retries: exponential (base 2) starting at `NT_WEBHOOK_INITIAL_DELAY_MS`, capped at `NT_WEBHOOK_MAX_DELAY_MS`, with ±20% jitter. Up to `NT_WEBHOOK_MAX_ATTEMPTS` attempts (default 12, ~24h). Exhaustion writes a `webhook_exhausted` audit row.

---

## Webhook payload contract

### Request

- **Method:** `POST`
- **Content-Type:** `application/json; charset=utf-8`
- **Body encoding:** UTF-8 JSON, no trailing newline
- **Timeout:** `NT_WEBHOOK_TIMEOUT_MS` (default 10s)

### Headers

| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | always |
| `User-Agent` | `lawallet-nostr-trigger/<version>` | semver from the service package |
| `Idempotency-Key` | `<event_id>` | the Nostr event id from the wallet; dedup key if the consumer also dedups |
| `X-LaWallet-Signature` | `sha256=<hex>` | HMAC-SHA256 of the **raw body** using the endpoint's secret. Verify server-side before trusting any field. |
| `X-LaWallet-Event-Kind` | `23196` or `23197` | shortcut for the Nostr event kind in the body |
| `X-LaWallet-Nwc-Id` | `<nwc_connection_id>` | shortcut for the connection id in the body |

### Body schema

Top-level envelope emitted by this service (same shape for every notification kind):

| Field | Type | Meaning |
|---|---|---|
| `event_id` | `string` (64-hex) | id of the underlying Nostr event (kind-23196 or 23197) as published by the wallet |
| `event_kind` | `number` | `23196` (legacy, NIP-04) or `23197` (current, NIP-44). Dual-publish wallets (Alby) already deduped before delivery — each `payment_hash` is POSTed once. |
| `nwc_connection_id` | `string` (cuid) | the `NwcConnection.id` this notification belongs to. Stable across webhook deliveries for the same wallet. |
| `payload` | `object` | the decrypted NIP-47 notification — pass-through of what the wallet sent |
| `payload.notification_type` | `string` | `"payment_received"` or `"payment_sent"` (per NIP-47). Also available as a top-level class of event. |
| `payload.notification` | `object` | the NIP-47 notification body (per NIP-47 §notifications) — fields below |
| `ts` | `string` | ISO-8601 timestamp of when **nostr-trigger dispatched** the webhook (not when the wallet received the payment — see `payload.notification.settled_at` for that) |

The `payload.notification` object's fields match the NIP-47 spec verbatim:

| Field | Type | Meaning |
|---|---|---|
| `type` | `string` | `"incoming"` or `"outgoing"` |
| `state` | `string` | `"settled"` / `"pending"` / `"failed"` (wallet-dependent) |
| `invoice` | `string` | bolt11 invoice |
| `description` | `string` | memo (may be empty) |
| `description_hash` | `string` | 64-hex or empty |
| `preimage` | `string` | 64-hex payment preimage (present once settled) |
| `payment_hash` | `string` | 64-hex — the natural idempotency key for the underlying payment |
| `amount` | `number` | amount in **millisats** |
| `fees_paid` | `number` | fees in millisats (typically 0 for incoming) |
| `created_at` | `number` | unix seconds (invoice creation time) |
| `expires_at` | `number` | unix seconds |
| `settled_at` | `number \| null` | unix seconds (set once settled) |
| `settle_deadline` | `number \| null` | unix seconds, held invoices only |
| `metadata` | `object \| null` | wallet-supplied extras (free-form) |

### Example

Real `payment_received` notification as POSTed by the service:

```http
POST /your-webhook HTTP/1.1
Host: example.com
Content-Type: application/json; charset=utf-8
User-Agent: lawallet-nostr-trigger/0.9.0
Idempotency-Key: 2042f60ac83f7e3fb3b99b25d97d4c962908bbf6529df7bfcea35836992cee39
X-LaWallet-Signature: sha256=0a1b2c…
X-LaWallet-Event-Kind: 23196
X-LaWallet-Nwc-Id: cmo91z0y900044yugbrddk3qq
```

```json
{
  "event_id": "2042f60ac83f7e3fb3b99b25d97d4c962908bbf6529df7bfcea35836992cee39",
  "event_kind": 23196,
  "nwc_connection_id": "cmo91z0y900044yugbrddk3qq",
  "payload": {
    "notification_type": "payment_received",
    "notification": {
      "type": "incoming",
      "state": "settled",
      "invoice": "lnbc100n1p570hc5pp5phwj6xvlc7cqtxteq8nusv72z0xzt8x95204eu88grkp6m8znphqdqqcqzzsxqyz5vqsp5wrt0z77attdepdzfymxz0u79hg0nygj0pkdum2dh7jpra4vwj8yq9qxpqysgqayjfyw26t6fwvrqusskgsuq9nx3n773phlqva4e9nsjd4rw80f75qe3xtftn4d3kguckulplckmfpk7dtmv7sh7k7tmj60e339ra5jsqr3d5zg",
      "description": "",
      "description_hash": "",
      "preimage": "ad0732fdb4318b6425aefdb3b3443723339488f9b03ca8497cd65abe85b025d9",
      "payment_hash": "0ddd2d199fc7b005997901e7c833ca13cc259cc5a29f5cf0e740ec1d6ce2986e",
      "amount": 10000,
      "fees_paid": 0,
      "created_at": 1776803604,
      "expires_at": 1776890004,
      "settled_at": 1776803611,
      "settle_deadline": null,
      "metadata": null
    }
  },
  "ts": "2026-04-21T20:33:32.159Z"
}
```

### Response contract (what consumers should return)

| Status | Treated as | Retry? |
|---|---|---|
| `2xx` | success | no |
| `4xx` except 408/429 | terminal failure | no — audit entry written |
| `408`, `429`, `5xx`, network error, timeout | retryable | yes — exponential backoff + jitter |

Consumers should finish processing and respond within 10 seconds. Longer processing belongs in the consumer's own background queue; do not hold the connection open.

### Signature verification

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

Verify against the **raw request body** — re-serialising JSON before hashing will break the check.

### Idempotency guidance

- The same `payment_hash` will not be POSTed twice to the same endpoint — `nostr-trigger` dedups both at event-id and at `(nwc_id, notification_type, payment_hash)` before enqueuing.
- But a webhook **can** be delivered more than once if the consumer returns a retryable status and the next attempt succeeds. Treat `Idempotency-Key` (= `event_id`) as the dedup key on the consumer side if "exactly-once" effects are required.

---

## Database change propagation

`nostr-trigger` reacts in real time to any `INSERT` / `UPDATE` / `DELETE` on the `NwcConnection` table — regardless of which process did the mutation (this service's own HTTP/Nostr command path, `apps/web`, a manual `psql` statement, a future migration, etc.). It does this by consuming Postgres `LISTEN`/`NOTIFY` rather than polling.

**Setup (installed by migration [20260421180000_nwc_change_notify](../../packages/prisma/migrations/20260421180000_nwc_change_notify/migration.sql)):**

- A PL/pgSQL trigger function `notify_nwc_connection_change()` emits `pg_notify('nwc_connection_change', json)` with `{ op, id, enabled }`.
- Row-level trigger `nwc_connection_change_trigger` fires `AFTER INSERT OR UPDATE OR DELETE` on `"NwcConnection"`.

**Listener ([src/db/change-listener.ts](../../apps/nostr-trigger/src/db/change-listener.ts)):**

- Dedicated `pg.Client` (not Prisma — Prisma's pooled client does not expose `LISTEN`).
- On each notification dispatches to `ConnectionManager`:
  - `INSERT` → `open(id)`
  - `UPDATE` → `reload(id)` (close + re-open with fresh state; `open` itself skips disabled rows)
  - `DELETE` → `close(id)`
- **Reconnect:** if the LISTEN socket drops (pg restart, network hiccup), reconnect with exponential backoff (3s → 30s cap). On successful reconnect, runs a full `reloadAll()` to catch up any missed mutations.
- **Safety net:** every 5 minutes runs `reloadAll()` regardless. Cheap insurance against silent notification loss (network partitions, pgbouncer quirks, etc.).

**Minimal payload, deliberately:** only `id` + `enabled` + `op` go through NOTIFY — the listener re-queries the full row via Prisma. Keeps payloads far below the 8 KB pg_notify limit and avoids leaking encrypted secrets through the notification channel.

Payload example:

```json
{ "op": "UPDATE", "id": "cmo91z0y900044yugbrddk3qq", "enabled": true }
```

---

## Resilience guarantees

| Failure mode | Mitigation |
|---|---|
| Service restart | Per-`(nwc,relay)` `since` cursor in Redis; subscribe from `cursor - NT_CURSOR_OVERLAP_SECONDS`. Dedup drops the replays. |
| Duplicate event from multiple relays | `SET NX nt:dedup:<id> EX 259200` — exactly one downstream effect per event id within the TTL. |
| Webhook consumer down | BullMQ holds the job, retries with backoff for up to ~24h, then DLQ + audit. |
| Service crash mid-dispatch | BullMQ jobs are durable in Redis; the next worker instance resumes them. |
| Slow/offline relay | One relay cannot block others — `Promise.allSettled` on publishes, and `SimplePool` isolates per-socket failures. |
| Secret at rest exposure | `NwcConnection.clientSecret` and `WebhookEndpoint.secret` are AES-256-GCM envelopes. Plaintext never logged. |
| Nostr admin DM replay | Event id dedup applies to control-plane DMs too. |

---

## HTTP API

All endpoints under `/api/v1/` require `Authorization: Bearer $NT_ADMIN_SECRET`. All responses are `{"success":true,"data":...}` or `{"success":false,"error":{...}}`.

### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness — returns 200 immediately |
| GET | `/ready` | readiness — 200 only if DB + Redis + pool reachable |

### Authenticated

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| GET | `/api/v1/status` | — | Runtime: relay status list, active sub count, queue depth (waiting/active/delayed/failed) |
| GET | `/api/v1/nwc-connections` | — | List all NWC connections |
| POST | `/api/v1/nwc-connections` | `{ label, nwcUri, ownerUserId?, enabled? }` | Create from a NWC URI; service parses, derives `clientPubkey`, encrypts secret |
| GET | `/api/v1/nwc-connections/:id` | — | Get one |
| PATCH | `/api/v1/nwc-connections/:id` | `{ label?, enabled?, relays? }` | Update; reloads subscription if relays/enabled changed |
| DELETE | `/api/v1/nwc-connections/:id` | — | Delete + tear down sub |
| GET | `/api/v1/nwc-connections/:id/webhooks` | — | List webhooks for an NWC |
| POST | `/api/v1/webhooks` | `{ nwcConnectionId, url, secret?, eventKinds?, enabled? }` | Create; returns plaintext `secret` once |
| DELETE | `/api/v1/webhooks/:id` | — | Delete |
| POST | `/api/v1/webhooks/:id/test` | — | Enqueue a synthetic event to verify the endpoint |
| GET | `/api/v1/relays` | — | Distinct relay URLs + per-relay connected/lastError/sub count |
| POST | `/api/v1/relays/reload` | — | Tear down + reopen all subscriptions |
| GET | `/api/v1/admins` | — | List `NostrTriggerAdmin` allowlist entries |
| POST | `/api/v1/admins` | `{ pubkey, label? }` | Add a pubkey to the Nostr admin allowlist |
| DELETE | `/api/v1/admins/:id` | — | Remove |
| GET | `/api/v1/audit?limit=100` | — | Most recent `AuditEvent` rows |
| POST | `/api/v1/zap/publish` | `{ bolt11, preimage?, zapRequest, recipientPubkey, extraRelays? }` | Sign + publish a NIP-57 kind-9735 receipt |

### Error codes

`VALIDATION_ERROR` (400), `AUTHENTICATION_ERROR` (401), `AUTHORIZATION_ERROR` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_SERVER_ERROR` (500).

---

## Nostr control plane

### Encryption

- Service subscribes to `{kinds:[4], #p:[servicePubkey], since:boot}` on `NT_CONTROL_RELAYS`.
- Request content is NIP-44 (with NIP-04 fallback) JSON.
- Reply is a signed kind-4 event addressed back to the sender with NIP-44 encrypted JSON `{id, ok, result?|error?}`.

### Authorization

A sender pubkey is authorized iff:
- It is present in `NostrTriggerAdmin.pubkey`, OR
- It belongs to a `User` row with `role = 'ADMIN'` in the shared Postgres.

Unauthorized senders receive `{ok:false, error:"unauthorized"}` — the service does not reveal whether the pubkey was recognized.

### Command surface

Payload shape: `{ "id": "<uuid>", "op": "<name>", ...<params> }`.

| `op` | Params | Maps to |
|---|---|---|
| `status` | — | `GET /status` |
| `list_nwc` | — | `GET /nwc-connections` |
| `get_nwc` | `nwcConnectionId` | `GET /nwc-connections/:id` |
| `create_nwc` | `params: { label, nwcUri, ownerUserId?, enabled? }` | `POST /nwc-connections` |
| `update_nwc` | `nwcConnectionId`, `params: {...}` | `PATCH /nwc-connections/:id` |
| `delete_nwc` | `nwcConnectionId` | `DELETE /nwc-connections/:id` |
| `list_webhooks` | `nwcConnectionId` | `GET /nwc-connections/:id/webhooks` |
| `create_webhook` | `params: {...}` | `POST /webhooks` |
| `delete_webhook` | `webhookEndpointId` | `DELETE /webhooks/:id` |
| `test_webhook` | `webhookEndpointId` | `POST /webhooks/:id/test` |
| `list_relays` | — | `GET /relays` |
| `reload_relays` | — | `POST /relays/reload` |
| `list_admins` | — | `GET /admins` |
| `add_admin` | `params: { pubkey, label? }` | `POST /admins` |
| `remove_admin` | `adminId` | `DELETE /admins/:id` |
| `audit_tail` | `limit` | `GET /audit` |
| `publish_zap` | `params: {...}` | `POST /zap/publish` |

Every successful Nostr command writes an `AuditEvent` row with `source:"nostr"`, `actor:<senderPubkey>`.

---

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | |
| `NT_PORT` | no | `3010` | HTTP listen port |
| `NT_LOG_LEVEL` | no | `info` | pino level |
| `NT_LOG_PRETTY` | no | `false` | pino-pretty transport (dev only) |
| `NT_MASTER_KEY` | **yes** | — | Base64-encoded 32 bytes. AES-GCM key for secret fields. Generate with `openssl rand -base64 32` |
| `NT_ADMIN_SECRET` | **yes** (unless `DANGEROUSLY_FREE=true`) | — | Bearer token for HTTP admin API. Generate with `openssl rand -hex 32` |
| `DANGEROUSLY_FREE` | no | `false` | **Dev only.** When `true`, disables **every** authorization check: HTTP Bearer validation AND Nostr admin allowlist/role checks. Any caller can run any command. See warning below. |
| `NT_SERVICE_NSEC` | **yes** | — | Nostr key for the control plane (receives DMs + signs replies) |
| `NT_CONTROL_RELAYS` | no | — | Comma-separated relays the control plane listens on |
| `NT_LNURL_NSEC` | no | — | Nostr key that signs NIP-57 zap receipts; required to use `/zap/publish` |
| `NT_ZAP_DEFAULT_RELAYS` | no | — | Comma-separated relays; merged with the zap request's relays on publish |
| `DATABASE_URL` | **yes** | — | Postgres — shared with `apps/web` |
| `REDIS_URL` | no | `redis://localhost:6379/0` | Redis for BullMQ + dedup + cursors |
| `NT_WEBHOOK_MAX_ATTEMPTS` | no | `12` | BullMQ `attempts` |
| `NT_WEBHOOK_INITIAL_DELAY_MS` | no | `10000` | Backoff base |
| `NT_WEBHOOK_MAX_DELAY_MS` | no | `3600000` | Backoff cap |
| `NT_WEBHOOK_TIMEOUT_MS` | no | `10000` | Per-request fetch timeout |
| `NT_DEDUP_TTL_SECONDS` | no | `259200` | `nt:dedup:*` TTL (72h) |
| `NT_CURSOR_OVERLAP_SECONDS` | no | `60` | How far before the persisted cursor we subscribe on restart |

---

## ⚠️ DANGEROUSLY_FREE mode

Setting `DANGEROUSLY_FREE=true` turns every authorization check in the service into a no-op:

- HTTP requests to `/api/v1/*` are accepted **without** a `Bearer` token.
- Nostr control-plane DMs are treated as authorized regardless of sender pubkey (the `User.role=ADMIN` and `NostrTriggerAdmin` allowlist checks are skipped).

Audit rows are still written with the real sender pubkey on the Nostr side, and with `actor: null` on the HTTP side (since there is no caller identity). The service logs a loud `WARN` block at startup whenever this flag is on.

Intended use cases: local development, CI smoke tests, integration fixtures. **Never set this in production, staging, or any environment reachable from untrusted networks.** Anyone who can reach the HTTP port or the service's Nostr pubkey can create/delete NWC connections, fire test webhooks, and publish zaps.

---

## Operational runbook

### Start locally

```bash
docker compose up -d postgres redis
pnpm --filter @lawallet-nwc/prisma run db:migrate:deploy
cp apps/nostr-trigger/.env.example apps/nostr-trigger/.env
# fill NT_MASTER_KEY, NT_ADMIN_SECRET, NT_SERVICE_NSEC, NT_LNURL_NSEC, relays
pnpm --filter @lawallet-nwc/nostr-trigger dev
```

### Add an NWC

```bash
curl -sS http://localhost:3010/api/v1/nwc-connections \
  -H "Authorization: Bearer $NT_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label":"alice wallet","nwcUri":"nostr+walletconnect://...","enabled":true}' | jq
```

### Add a webhook to that NWC

```bash
curl -sS http://localhost:3010/api/v1/webhooks \
  -H "Authorization: Bearer $NT_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"nwcConnectionId":"<id>","url":"https://example.com/webhook","eventKinds":[23196,23197]}' | jq
```

### Inspect runtime

```bash
curl -sS http://localhost:3010/api/v1/status \
  -H "Authorization: Bearer $NT_ADMIN_SECRET" | jq
```

### Rotate keys

1. Generate a new `NT_MASTER_KEY`.
2. Write a migration script that reads every `NwcConnection.clientSecret` + `WebhookEndpoint.secret`, decrypts with the old key, re-encrypts with the new, updates the rows in a transaction.
3. Restart the service with the new `NT_MASTER_KEY`.

### Drain the webhook queue

```bash
# via HTTP
curl -sS -X POST http://localhost:3010/api/v1/relays/reload \
  -H "Authorization: Bearer $NT_ADMIN_SECRET"

# via Bull Board (future): plug in @bull-board/hono at /admin/queues
```

### Reset dedup window (emergency)

```bash
redis-cli --scan --pattern 'nt:dedup:*' | xargs -n 100 redis-cli del
```
Only do this if you've verified nothing currently depends on dedup persistence; any in-flight events will be reprocessed.

---

## Testing

- Unit tests live in `apps/nostr-trigger/tests/unit/`:
  - `nwc-parse.test.ts` — NWC URI parsing, pubkey derivation
  - `crypto.test.ts` — AES-256-GCM round-trip + tamper detection
  - `encryption.test.ts` — NIP-44/NIP-04 decrypt fallback
  - `retry-policy.test.ts` — exponential backoff + jitter bounds
  - `redis-keys.test.ts` — key namespacing
  - `command-schemas.test.ts` — Zod discriminated union surface
- Integration tests (WIP — require Postgres + Redis) should live under `tests/integration/`.
- Run: `pnpm --filter @lawallet-nwc/nostr-trigger test`.
