# Month 5: Card System + Platform Polish + NWC Listener Lite

**Period:** May 5 – June 5, 2026
**Status:** Planned
**Depends on:** [Month 4](MONTH-4.md) (User Wallet + Admin Dashboard E2E + Schema Rewrite)

## Summary

With LUD-12/16/21 compliance, the OpenAPI spec, and the docs site overhaul already shipped in Month 4, the original Month 5 plan no longer applies. This month splits cleanly into two themes:

1. **Card System Completion** — finish the BoltCard story end-to-end: Android login app, the rebrand of `simple-card-manager`, and a working issue → activate → pair → pay flow.
2. **Platform Polish & Integrations** — full NIP-05, relay preferences, user data cache, onboarding-v2 with Cloudflare detection, the **NWC Payment Listener (lite, transport-only)** merged from the [`nostr-trigger` branch](https://github.com/lawalletio/lawallet-nwc/tree/nostr-trigger), LUD-22 webhook plumbing, the `@lawallet-nwc/react` hooks package, multi-email (Resend), dashboard cache, PWA wallet, the admin Subscription Manager, bug fixes, and the landing CRM swap.

Full LUD-16/21/22 + NIP-57 **compliance** moves to [Month 6](MONTH-6.md), where it ships through the NWC Proxy Lite settlement layer.

---

## Goals

### A. Card System Completion

- Android BoltCard app login (NTAG424 → web auth)
- Rebrand of [lawalletio/simple-card-manager](https://github.com/lawalletio/simple-card-manager)
- Connect Card system end-to-end (issue → activate → pair → pay)

### B. Platform Polish & Integrations

- Full NIP-05 (`.well-known/nostr.json` + relays + avatar)
- User-level relay picker preference (persisted)
- User data cache — backend storage for Nostr profile + relay-list metadata
- Onboarding v2 — autodetect Cloudflare/DNS state, surface setup instructions
- NWC Payment Listener (lite, transport-only) — merge `nostr-trigger`
- LUD-22 webhook delivery via the listener
- `@lawallet-nwc/react` hooks package (`useLaWallet`, etc.)
- Multi-email provider — add Resend adapter alongside SMTP
- Dashboard cache pages — Next.js Cache Components, dedupe `getSettings`
- PWA Wallet (manifest, service worker, install prompt, offline)
- Subscription manager (admin) — endpoint stores signed-Nostr followers, optional NIP-04 reply via instance nsec
- Bug fixes — card-design dropdown stale state, redundant `getSettings`
- LaWallet landing — swap Tally for the operator's CRM

---

## A. Card System Completion

### Android BoltCard App Login

- Native (or PWA-shell) Android app that scans an NTAG424 card and authenticates the holder against the LaWallet web app
- Flow: scan → derive auth challenge → sign with card key → exchange for JWT
- Reuses the existing `Ntag424` model and OTC activation flow from Month 1

### `simple-card-manager` Rebrand

- Fork or take over [lawalletio/simple-card-manager](https://github.com/lawalletio/simple-card-manager)
- Apply LaWallet branding (logo, colors, copy)
- Republish under `@lawalletio` org
- Wire up to the LaWallet API (cards, designs, NTAG424)

### Connect Card System End-to-End

- Issue: admin creates a card with a design, prints/writes NTAG424
- Activate: holder taps card on phone, completes OTC activation
- Pair: card binds to a user (npub + lightning address)
- Pay: tap-to-pay over BoltCard NFC + LNURL-pay flow lands at the holder's wallet
- E2E test (Playwright + simulated NFC) covers the full happy path

---

## B. Platform Polish & Integrations

### NIP-05 — Full Implementation

Deferred from Month 4. Resolves `username@domain` to a complete Nostr identity, not just a pubkey:

- Public `.well-known/nostr.json` endpoint per [NIP-05 spec](https://github.com/nostr-protocol/nips/blob/master/05.md)
- Returns `{ names: { username: pubkey }, relays: { pubkey: [relay-urls] } }`
- Avatar served from cached kind:0 metadata (sourced from the user's relays)
- Caches kind:0 + relay-list (kind:10002) for the user, refreshed on a TTL

### Relay Picker

- Per-user preference for preferred relays (used for kind:0/10002 fetches and zap delivery)
- Persisted on the `User` model
- Settings UI in the user wallet
- Reused by NIP-05 cache, the listener, and the user wallet

### User Data Cache

- Backend table for cached Nostr profile (kind:0) + relay-list (kind:10002)
- TTL-based refresh, manual invalidation endpoint
- Served to the listener, admin UI, NIP-05 endpoint, and `/api/users/[userId]`
- Avoids hammering relays on every request

### Onboarding Flow v2

The Month 4 setup wizard already verifies the domain. v2 adds infrastructure auto-detection:

- Detect whether the domain is fronted by Cloudflare (header sniff or NS record check)
- Surface concrete setup instructions per detected provider (Cloudflare DNS records, SSL toggle)
- Detect missing DNS records and link to the operator's DNS dashboard (one-click where possible)
- Validate `.well-known` reachability before completing the wizard

### NWC Payment Listener (Lite, transport-only)

The [`nostr-trigger` branch](https://github.com/lawalletio/lawallet-nwc/tree/nostr-trigger) is merged and re-scoped as a thin transport service. **All business logic lives in `apps-web`.**

**Architecture:**

- Reads `NWCConnection` rows via PG `LISTEN`/`NOTIFY` from the **shared web-app Postgres** (lite mode = no isolated DB)
- Maintains relay-pool subscriptions for each NWC connection, **kept in memory** for low latency
- Deduplicates events (by event id + connection)
- Auto-reconnects with backoff on relay disconnects
- On incoming Nostr event → POSTs a webhook to `apps-web`
- `apps-web` may return Nostr events in the response → listener publishes them to the user's relays (the listener already holds those connections)

**What the listener does NOT do:**

- No NWC business logic (no payment matching, no zap-receipt minting)
- No DLQ — retries happen by `apps-web` re-emitting via NOTIFY
- No own database

[`docs/services/NWC-LISTENER.md`](../services/NWC-LISTENER.md) is rewritten in this period to reflect this transport-only role; the previous "isolated DB" target is dropped.

### LUD-22 Webhook Delivery

Hooked into the listener → apps-web webhook contract above. Operators register a webhook URL per lightning address; the web app dispatches LUD-22 payloads when the listener forwards a payment event.

- Webhook registration endpoint (admin + per-user)
- HMAC-SHA256 signature header (`X-LaWallet-Signature`)
- Delivery handled by `apps-web` (retry policy lives there, not in the listener)
- Admin UI lists registered webhooks + recent delivery status

> Full LUD-22 protocol compliance ships in Month 6 via the Proxy Lite. Month 5 delivers the working webhook **plumbing**.

### `@lawallet-nwc/react` Hooks Package

- Extract `useLaWallet`, `useNwcBalance`, `useApi`, `useWallet*` etc. from `apps/web/lib/client/hooks/`
- Publish under `@lawallet-nwc/react` (currently a stub workspace)
- Reuse the SWR + SSE patterns established in Month 4
- Code snippets in the docs site

### Multi-Email Provider (Resend)

- Add a Resend adapter alongside SMTP in the existing email service layer
- Operator selects provider in **Settings → Infrastructure**
- Required env: `RESEND_API_KEY`
- Email templates remain provider-agnostic

### Dashboard Cache Pages

- Adopt Next.js Cache Components / `cache()` for read-heavy admin pages
- Dedupe redundant `/api/settings` calls across the dashboard (a known M4 leak — surfaces in Topbar, Sidebar, Branding, Wallet tab simultaneously)
- Revalidate on settings mutation via SSE

### PWA Wallet

- Web app manifest (icons, theme color, install prompts)
- Service worker for offline cache (extend the existing `activity-cache` + balance cache)
- Install prompt UX in the user wallet
- iOS / Android install instructions

### Subscription Manager (admin)

A new admin feature for capturing potential followers via Nostr.

- `POST /api/subscriptions/subscribe` accepts `{ pubkey, signedEvent }` (NIP-22-style signed nostr event)
- Verifies the signature, stores `(pubkey, signedAt, source)` as a potential follower
- Optional NIP-04 reply: instance signs and DMs a welcome message via the configured instance nsec
- Instance nsec storage: encrypted-in-DB, opt-in per instance (operator must enable in Settings)
- Admin UI: list of subscribers, export (CSV), broadcast (kind:1 / kind:4 to opted-in pubkeys)
- Rate-limited; respects spam protections

### Bug Fixes

- **Card design dropdown stale state** — when an admin creates a new card design, the "Add new card" dropdown does not pick it up until refresh. Fix: revalidate the design list after mutation (SWR / cache invalidation)
- **Redundant `getSettings` calls** — Topbar, Sidebar, Branding, Wallet tab all fetch independently. Fix: centralize via a shared SWR key or React Server Component

### LaWallet Landing — CRM Swap

Out-of-tree (lives in the `lawallet-landing` repo). Replace the Tally form with the operator's CRM (target TBD: Resend forms, Beehiiv, Bento, or pluggable adapter).

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| Android BoltCard login | App scans → JWT issued → reaches /wallet | P0 |
| `simple-card-manager` rebrand | Repo forked, branded, published | P1 |
| Connect Card E2E | Issue → activate → pair → pay green path | P0 |
| NIP-05 | `.well-known/nostr.json` resolves with relays + avatar | P0 |
| Relay picker | Persisted per user, used by NIP-05 cache | P1 |
| User data cache | Cached kind:0 + relay-list, TTL refresh | P1 |
| Onboarding v2 | Cloudflare auto-detect + DNS instructions | P1 |
| Listener (lite) | Merged from `nostr-trigger`, transport-only, PG NOTIFY → webhook works | P0 |
| LUD-22 plumbing | Webhook registration + delivery via listener | P0 |
| `@lawallet-nwc/react` | Package extracted, published, used by docs examples | P1 |
| Resend adapter | Email sends through Resend; toggle in Settings | P2 |
| Dashboard cache | Single `getSettings` per page; cache hits visible in profiler | P1 |
| PWA Wallet | Installable, runs offline with last-known balance | P1 |
| Subscription Manager | Endpoint accepts signed events, opt-in nsec, admin export | P1 |
| Bug fixes | Card-design dropdown updates; `getSettings` deduped | P1 |
| Landing CRM | Tally replaced with operator's CRM (in `lawallet-landing`) | P2 |
