# Month 6: NWC Payment Listener + NWC Proxy Lite + Lightning Compliance + Deployment

**Period:** June 5 – July 5, 2026
**Status:** Planned
**Depends on:** [Month 5](MONTH-5.md)

## Summary

- NWC Payment Listener (lite, transport-only) + LUD-22 webhook plumbing
- NWC Proxy Lite — settlement layer; LUD-16 / LUD-21 / LUD-22 / NIP-57 compliance
- `@lawallet-nwc/react` extraction
- Multi-email (Resend) adapter
- Nostr scheduler
- Full wallet settings
- Deploy targets: Vercel / Netlify / Umbrel / Start9 / Docker Compose
- Documentation finalization + threat model
- SDK + Hooks finalization
- Security audit readiness

---

## Goals

- NWC Payment Listener (lite, transport-only) in `apps/listener/`
- LUD-22 webhook plumbing through the listener
- NWC Proxy Lite — settlement layer providing LUD-16, NIP-57, LUD-21, LUD-22
- Full LUD-16 / LUD-21 / LUD-22 + NIP-57 compliance closeout
- `@lawallet-nwc/react` — extract the hooks package from `apps/web/lib/client/hooks/` and publish
- Multi-email provider — Resend adapter alongside SMTP, operator-selectable in Settings
- Nostr scheduler — pre-sign Nostr posts; cron-dispatched via the listener
- Full Wallet settings (theme, notifications, default currency, contact list)
- Deployment targets: Vercel, Netlify, Umbrel, Start9, Docker Compose
- Documentation finalization (service docs, threat model, migration guides)
- SDK + Hooks finalization
- Security audit readiness

---

## NWC Payment Listener (Lite, transport-only)

Built in `apps/listener/`, replacing the echo stub. Reads NWC Remote Wallets from the web app's Postgres, subscribes to relays, forwards events to `apps/web` via webhook. All business logic stays in `apps/web`.

**Architecture:**

- Lives in `apps/listener/` — shares `packages/shared` types; deployed as its own container
- Connects to the same Postgres as the web app (read-only role recommended) — no schema, no migrations
- `LISTEN remote_wallets` (or similar); `apps/web` emits `NOTIFY` when a `RemoteWallet` row of `type = NWC` is created, updated, revoked, or needs a resubscribe
- On each notification, reconciles in-memory relay-pool subscriptions to the active set of NWC Remote Wallets
- Deduplicates events (by event id + Remote Wallet)
- Auto-reconnects with backoff on relay disconnects
- On incoming Nostr event → POSTs a webhook to `apps/web` (HMAC-signed)
- `apps/web` may return Nostr events in the response → listener publishes them to the user's relays

**Non-goals:**

- No NWC business logic (no payment matching, no zap-receipt minting)
- No writes to the shared Postgres — strictly `LISTEN` + read
- No DLQ — retries happen by `apps/web` re-emitting via `NOTIFY`
- No own database, no migrations, no Prisma client
- No handling of non-NWC Remote Wallets

[`docs/services/NWC-LISTENER.md`](../services/NWC-LISTENER.md) rewritten for the transport-only role.

### LUD-22 Webhook Plumbing

Listener → `apps/web` webhook contract. Operators register a webhook URL per lightning address; `apps/web` dispatches LUD-22 payloads on payment events.

- Webhook registration endpoint (admin + per-user)
- HMAC-SHA256 signature header (`X-LaWallet-Signature`)
- Delivery + retry policy in `apps/web`
- Admin UI lists registered webhooks + recent delivery status

---

## NWC Proxy Lite (Settlement Layer)

Settlement engine for inbound Lightning payments to LaWallet addresses. Mints invoices through the holder's Remote Wallet of `type = NWC`; ships the LUD-16 / LUD-21 / LUD-22 / NIP-57 compliance surface.

### Role

When a payer hits `username@domain.com`:

1. `apps/web` resolves the address and returns LUD-16 metadata
2. On the LNURL-pay callback, `apps/web` asks the Proxy to mint an invoice through the holder's `RemoteWallet` (NWC driver)
3. Proxy creates the invoice (via NWC `make_invoice`), returns it
4. When the payment lands, the listener forwards the event to `apps/web`, which dispatches LUD-22 webhooks and emits NIP-57 zap receipts

### Scope

- Single-tenant — runs alongside the listener
- No multi-provider adapter layer
- Uses the holder's existing `RemoteWallet` (NWC driver) — no provisioning of new courtesy wallets

### Compliance through the Proxy

- **LUD-16** — `.well-known/lnurlp/<username>` per spec, including `allowsNostr` + `nostrPubkey`
- **NIP-57** — kind 9735 zap-receipt minting + verification
- **LUD-21** — `verify` URL on every invoice; status check endpoint
- **LUD-22** — webhook subscription dispatched on payment receipt; spec-correct payload + signature + retry

---

## Lightning Address Compliance Closeout

| Standard | M4 status | M6 closeout work |
|----------|-----------|------------------|
| LUD-12 (comments) | ✅ shipped | — |
| LUD-16 (lightning address) | ✅ mode-aware resolver | Polish `.well-known/lnurlp` schema, finalize metadata |
| LUD-21 (verify) | ✅ endpoint shipped | Tighten edge cases (expired, double-pay), add status enum |
| LUD-22 (webhooks) | — | Listener-side plumbing + spec-correct payload, signature, retry + DLQ |
| NIP-57 (zaps) | — | Receipt minting via Proxy, verification, integration tests with Damus / Amethyst / Primal |

### Protocol Compliance Matrix After Month 6

| Standard | Name | Status |
|----------|------|--------|
| LUD-12 | Comments | Full compliance |
| LUD-16 | Lightning Address | Full compliance |
| LUD-21 | Verify | Full compliance |
| LUD-22 | Webhooks | Full compliance |
| NIP-57 | Zaps | Full compliance |
| NIP-47 | NWC | Used by Proxy + Listener |

---

## Multi-Email Provider (Resend)

- Resend adapter alongside SMTP in the existing email service layer
- Operator selects provider in **Settings → Infrastructure**
- Required env: `RESEND_API_KEY`
- Email templates remain provider-agnostic

---

## Nostr Scheduler

- Admin pre-signs Nostr events (kind:1 by default, configurable) with the instance nsec
- Events stored with a `scheduledAt` timestamp
- Cron job in the listener publishes them at the scheduled time
- Admin UI: compose, schedule, list pending, cancel

---

## Full Wallet Settings

- Theme preference (light / dark / system)
- Notification settings (which payment events trigger UI notifications)
- Default currency (sats / BTC / fiat)
- Contact list (add / edit / export)
- Privacy settings (reveal balance, hide address)
- Remote Wallets management (list, switch default, disable, revoke) — extends the M5 Remote Wallets page with deeper management actions

---

## Deployment Targets

### Vercel

- `vercel.json` deploy
- Document env-var mapping for Listener + Proxy (deployed separately)

### Netlify

- `netlify.toml` for `apps/web`
- Build command, output dir, redirect rules
- Web only — Listener + Proxy deployed separately

### Umbrel

- `umbrel-app-store` package with all 3 containers (`web` + `listener` + `proxy`; `listener` and `proxy` may share an image)
- Configuration options
- Installation walkthrough in the docs site

### Start9

- Embassy service wrapper with all 3 services
- Manifest, health checks
- Submission to Start9 registry

### Docker Compose

- Production `docker-compose.yml` with reverse proxy (Traefik)
- SSL/TLS guide (Let's Encrypt + Traefik)
- Volume layout, backup strategy

---

## Documentation Finalization

### API Docs

- Examples on every endpoint
- Auth diagrams (NIP-98 → JWT exchange)
- Webhook payload reference (LUD-22)

### Service Docs

- `NWC-LISTENER.md` — transport-only role
- `NWC-PROXY.md` — Lite settlement role (single-tenant, no multi-provider adapters)

### Threat Model + Crypto Operations

- NWC encryption (NIP-47)
- NTAG424 chip encryption (AES-CMAC)
- Webhook HMAC-SHA256 signing
- JWT generation + verification
- Instance nsec handling (encrypted DB storage)
- Nostr signing flows (NIP-07 / NIP-46)

### Migration Guide

Schema changes since v0.10.0; migration steps for self-hosters running the M4 release.

---

## SDK + Hooks Finalization

- `@lawallet-nwc/sdk` — stub workspace → full client (see [SDK.md](../SDK.md))
- `@lawallet-nwc/react` extraction — pull `useLaWallet`, `useNwcBalance`, `useApi`, `useWallet*` etc. out of `apps/web/lib/client/hooks/`; publish under `@lawallet-nwc/react`; SWR + SSE patterns; docs snippets per hook
- Migration guide for SDK consumers

---

## Security Audit Readiness

- Attack-surface inventory per service (web / listener / proxy)
- Dependency audit (`pnpm audit`) clean across the workspace
- Authentication-flow review (NIP-98, JWT, RBAC, nsec handling)
- Static analysis pass (ESLint + a chosen security-focused linter)
- Audit-ready PR template + reproduction instructions

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| NWC Payment Listener (lite) | Built in `apps/listener/`, transport-only, shares Postgres via `LISTEN`/`NOTIFY` keyed on `RemoteWallet` rows of `type = NWC` → HMAC-signed webhook to `apps/web` works | P0 |
| LUD-22 listener plumbing | Webhook registration + delivery via listener; backend retry policy + DLQ | P0 |
| NWC Proxy Lite | Mints invoices via NWC; LUD-16 callback returns Proxy invoice | P0 |
| LUD-16 closeout | `.well-known/lnurlp` spec-correct, `allowsNostr` + `nostrPubkey` set | P0 |
| LUD-21 closeout | Verify endpoint covers all payment states | P0 |
| LUD-22 closeout | Spec-correct payload + HMAC + retry policy | P0 |
| NIP-57 zaps | Zap receipts created and verified, tested with Damus/Amethyst/Primal | P0 |
| Nostr scheduler | Admin can compose + schedule kind:1 / kind:4; cron dispatches them | P1 |
| Full Wallet settings | Theme, notifications, currency, contacts, privacy, Remote Wallets mgmt | P1 |
| Resend adapter | Email sends through Resend; SMTP/Resend toggle in Settings → Infrastructure | P1 |
| Vercel | One-click deploy still green | P1 |
| Netlify | `netlify.toml` validated, web app deploys | P1 |
| Umbrel | All 3 containers in app store, installable | P0 |
| Start9 | Embassy package submitted | P1 |
| Docker Compose | Production compose + reverse proxy + SSL guide | P0 |
| Service docs | `NWC-LISTENER.md` + `NWC-PROXY.md` reflect Lite reality | P0 |
| Threat model | Crypto operations + attack surfaces documented | P1 |
| SDK | `@lawallet-nwc/sdk` published, no stub warnings | P1 |
| `@lawallet-nwc/react` | Package extracted from `apps/web/lib/client/hooks/`, published, used by docs examples | P1 |
| Security audit prep | Inventory + audit + lint + PR template | P1 |
