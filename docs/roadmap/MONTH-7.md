# Month 7: Subscription Manager + Nostr Chat + Email Bridge + i18n

**Period:** July 5 – August 5, 2026
**Status:** In Progress
**Depends on:** [Month 6](MONTH-6.md)

> **The active window.** Month 7 clears the work carried over from [Month 6](MONTH-6.md) before starting its own scope. The Subscription Manager and email bridge below build directly on the carried-over NWC Proxy Lite and Resend adapter.

## Carried over from Month 6 (do first)

- **MASTER card account-share** — the FOREVER-QR flow on top of the shipped SIMPLE / ONE_TIME activation: `CardClaim` / `LightningAddressShare` / `RemoteWalletShare` model + claim / share-revoke endpoints (enum values already reserved in the schema)
- **NWC Proxy Lite** settlement layer + full **LUD-16 / LUD-21 / LUD-22 / NIP-57** closeout — see [Month 6](MONTH-6.md) for the full spec
- **`@lawallet-nwc/react`** hooks package extraction
- **WordPress plugin** (`lawallet-wordpress`)
- **Resend** email adapter (foundation for the email-to-Nostr bridge below)
- **Nostr scheduler**, threat model + security-audit prep, Vercel / Netlify deploy configs

## Summary

- Subscription Manager — paid tiers (monthly / one-time) with perks: vanity Lightning address, email-to-Nostr bridge, sat allowance
- Nostr Chat — DMs over NIP-17 / NIP-44 (NIP-04 fallback); thread metadata only in DB
- Operator → user broadcast
- Email-to-Nostr bridge — `username+inbox@domain.com` → NIP-44 DM
- Internationalization (i18n) — `next-intl`, locales at launch: `en` / `es` / `pt-BR`
- No new containers — work folds into `apps/web` and `apps/listener`

---

## Goals

- Operator-defined subscription plans (price in sats, monthly or one-time, perk flags)
- Subscription purchase via the M6 NWC Proxy Lite; daily expiry cron in `apps/listener`
- Vanity / premium Lightning address perk
- Email-to-Nostr bridge perk (`username+inbox@domain.com`) on the M6 Resend adapter
- Sat allowance perk — `TokenAllocation` ledger credited monthly, consumed by M8 Agents first
- Nostr Chat — DMs over NIP-17 / NIP-44 (NIP-04 fallback); messages on relays, only thread metadata in DB
- Operator → user broadcast via instance nsec, segmented by tier
- Internationalization (i18n) — multi-locale UI, operator-selectable default locale

---

## A. Subscription Manager (Paid Tiers)

### Plans

- `SubscriptionPlan` model: `id, name, slug, priceSats, interval (MONTHLY | ONE_TIME), perks (Json), isActive, createdAt`
- Perks stored as flags: `vanityAddress`, `emailBridge`, `satAllowance` (with monthly grant amount)
- Admin UI in **Settings → Subscriptions**: create / edit / archive plans, view active subscribers, revenue summary

### Purchase flow

1. User clicks Subscribe on a plan
2. `apps/web` mints an invoice via the M6 NWC Proxy Lite addressed to the operator's wallet
3. User pays from their NWC wallet
4. `apps/listener` receives the payment event, POSTs to `apps/web` webhook
5. `apps/web` activates `Subscription.status = ACTIVE`, sets `expiresAt` (for `MONTHLY`), unlocks perks

### Lifecycle

- `Subscription` model: `id, userId, planId, status, startedAt, expiresAt, lastInvoiceId, createdAt`
- States: `PENDING → ACTIVE → EXPIRED | CANCELLED`
- Daily cron in `apps/listener` flips expired subscriptions, revokes perks, optionally DMs the user via instance nsec
- Renewal: user re-pays before expiry → `expiresAt` extends by interval

### Perk — Vanity Lightning Address

- Premium-tier users can claim a 3–7 character vanity address
- Reuses the existing `LightningAddress` model and resolution path
- Vanity claims expire if the subscription expires; address falls back or is freed

### Perk — Sat Allowance

- `TokenAllocation` model: `id, userId, kind (SUBSCRIPTION_GRANT | MANUAL), satsRemaining, satsGranted, sourceSubscriptionId?, expiresAt, createdAt`
- Monthly cron credits `SUBSCRIPTION_GRANT` rows from active subscriptions
- Consumed by M8 Agent runs before falling back to NWC payment
- Usage credit only — never converts to spendable Lightning sats

---

## B. Email-to-Nostr Bridge

Subscription perk gated by the `emailBridge` flag.

- Each subscriber gets `<username>+inbox@<domain>` as a sub-addressed inbox
- MX handled by an inbound provider (Resend Inbound or Amazon SES inbound)
- Provider POSTs parsed email JSON to `POST /api/email-bridge/inbound`
- `apps/web` validates the destination user has an active subscription with the `emailBridge` flag
- Forwards to `apps/listener` via PG NOTIFY → listener signs a NIP-44 DM with the instance nsec
- DM body: subject + plain-text snippet + a link back to the full message in the user dashboard
- Listener publishes the DM to the recipient's preferred relays

---

## C. Nostr Chat (DMs)

### Protocol stack

- NIP-17 gift-wrapped DMs (default)
- NIP-44 for the inner encryption
- NIP-04 fallback for legacy clients

### Architecture

- Messages live entirely on relays — `apps/web` does not store message bodies
- `ChatThread` model stores per-user thread metadata only: `id, userId, counterpartyPubkey, kind (DM), lastSeenAt, muted, pinned, createdAt`
- Frontend consumes the user's preferred relays directly (NIP-65 relay list); cache-and-display pattern
- New chat surface in the user wallet: thread list, message view, compose

### Operator → User Broadcast

- Admin UI: **Communications → Broadcast** — pick a segment (active subscribers, all users, single tier), compose, preview
- Backend signs NIP-44 DMs with the instance nsec
- Listener publishes to recipients' preferred relays
- Rate-limited; broadcast log persisted

---

## D. Internationalization (i18n)

### Scope

- Admin dashboard, user wallet, and onboarding wizard translatable
- Public LUD-16 / NIP-05 surfaces remain protocol-only (no UI strings to localize)
- Email templates ship per-locale variants

### Tech

- `next-intl` for App Router message catalogs and locale-aware routing
- Catalogs under `apps/web/messages/<locale>.json`; type-safe keys via generated `Messages` type
- ICU MessageFormat for plurals, dates, and sat-amount formatting
- Locale-aware number / currency rendering reuses the M6 default-currency setting

### Locales at launch

- `en` (source of truth)
- `es`
- `pt-BR`
- Community translations via `CONTRIBUTING-i18n.md`; missing keys fall back to `en`

### Locale resolution

- Per-user preference on `User` model (`locale` column), set during onboarding
- Operator-defined default via `Settings.i18n.defaultLocale`
- Anonymous visitors: `Accept-Language` header → operator default → `en`
- Locale switcher in user wallet settings and admin topbar

### Done means

- Every user-facing string in `apps/web` flows through `useTranslations()`
- ESLint rule (`react/jsx-no-literals` scoped to JSX text) prevents regressions
- `pnpm i18n:check` script verifies key parity across locale files in CI

---

## E. Settings Extensions

Namespaced keys added to the existing `Settings` model:

- `subscriptions.enabled`
- `subscriptions.defaultGrantSats`
- `email_bridge.provider` — `resend | ses | none`
- `email_bridge.inboundDomain`
- `chat.relays` — instance default relays
- `chat.allowOperatorBroadcast`
- `i18n.defaultLocale` — `en | es | pt-BR | ...`
- `i18n.enabledLocales` — whitelist surfaced in the user switcher

---

## Architecture Notes

- Container count stays at 3 (`web`, `listener`, `nwc-proxy`)
- `apps/web` owns the REST surface and frontend
- `apps/listener` gains: subscription expiry cron (daily), email-bridge inbound dispatch, DM publish
- NWC Proxy Lite (M6) used for subscription invoice creation
- M6 Resend adapter used for outbound email + the inbound bridge
- Instance nsec used for email-bridge DMs and operator broadcast

---

## API Routes (added in M7)

- `/api/admin/subscription-plans` — `GET`, `POST` (with `[id]` `GET` / `PATCH` / `DELETE`)
- `/api/subscriptions` — `GET` own list, `POST` start, `[id]` `GET` / `DELETE` (cancel)
- `/api/wallet/allocations` — `GET` user's allocation balance + history
- `/api/chat/threads` — `GET` list, `[id]` `GET` / `PATCH` (mute/pin)
- `/api/email-bridge/inbound` — webhook from email provider
- `/api/admin/communications/broadcast` — `POST`

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| Subscription plan CRUD (admin) | Operator creates a plan with price, interval, perk flags | P0 |
| Subscription purchase | Pay invoice → `Subscription.status = ACTIVE`; perk gates flip | P0 |
| Vanity LN address perk | Premium-tier user can claim a 3–7 char address | P0 |
| Sat-allowance ledger | `TokenAllocation` credited monthly; visible in user wallet | P0 |
| Daily expiry cron | Expired subscriptions flip to `EXPIRED`; perks revoke | P0 |
| Renewal flow | Re-pay before expiry extends `expiresAt` | P0 |
| Settings UI for subscriptions | Toggle + default grant amount editable | P0 |
| Email-to-Nostr bridge | Email to `alice+inbox@domain` arrives as NIP-44 DM | P0 |
| Chat DM (NIP-17 / NIP-44) | User-user DM round-trips through user's preferred relays | P0 |
| NIP-04 fallback | Legacy clients can still receive DMs | P1 |
| Operator → user broadcast | Admin sends DM to a segment via instance nsec | P0 |
| i18n — en/es/pt-BR | Locale switcher works; key parity enforced in CI | P0 |
| i18n — operator default locale | Anonymous visitors land in operator-selected locale | P1 |
| Group chat threads (NIP-29) | Deferred to M9 / post-roadmap | — |
| Paid relay perk (nostr.wine etc.) | Deferred to post-roadmap | — |

---

## Non-goals

- No NIP-29 group chat threads
- No paid Nostr relay perk (would add a 4th container)
- No Cashu eCash mint or eCash perks
- No agent-as-a-perk wiring — M8 Agents hook into the M7 sat-allowance ledger
