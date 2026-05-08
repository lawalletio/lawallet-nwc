# Month 7: Subscription Manager + Nostr Chat (Monetization Plane)

**Period:** July 5 – August 5, 2026
**Status:** Planned
**Depends on:** [Month 6](MONTH-6.md) (NWC Proxy Lite + Lightning Compliance + Listener)

## Summary

Month 7 turns LaWallet NWC into something operators can monetize. The headline deliverable is the **Subscription Manager**: operator-defined paid tiers (monthly or one-time) that unlock perks for users — vanity Lightning addresses, an email-to-Nostr bridge, and a sat allowance ledger that AI Agents in [Month 8](MONTH-8.md) will consume. Alongside it, **Nostr Chat (DMs)** lands so users can talk to each other and operators can broadcast to segments, reusing the M5 Follower Capture Endpoint instance-nsec mechanism.

> The legacy "Subscription Manager (admin)" entry from M5 has been renamed to **Follower Capture Endpoint**; the name is reused here for the paid-tier feature.

---

## Goals

- Operator-defined subscription plans (price in sats, monthly or one-time, perk flags)
- Subscription purchase via NWC Proxy Lite invoices; daily expiry cron in `apps/listener`
- Vanity / premium Lightning address perk
- Email-to-Nostr bridge perk (`username+inbox@domain.com`)
- Sat allowance perk — `TokenAllocation` ledger credited monthly, consumed by M8 Agents first
- Nostr Chat — DMs over NIP-17 / NIP-44 (NIP-04 fallback); messages live on relays, only thread metadata in DB
- Operator → user broadcast via instance nsec, segmented by tier
- No new containers — all work folds into `apps/web` and `apps/listener`

---

## A. Subscription Manager (Paid Tiers)

### Plans (operator-defined)

- `SubscriptionPlan` model: `id, name, slug, priceSats, interval (MONTHLY | ONE_TIME), perks (Json), isActive, createdAt`
- Perks stored as flags: `vanityAddress`, `emailBridge`, `satAllowance` (with monthly grant amount)
- Admin UI in **Settings → Subscriptions**: create / edit / archive plans, view active subscribers, revenue summary

### Purchase flow

1. User clicks Subscribe on a plan
2. `apps/web` mints an invoice via NWC Proxy Lite (M6) addressed to the operator's wallet
3. User pays from their NWC wallet
4. `apps/listener` receives the payment event, POSTs to `apps/web` webhook
5. `apps/web` activates `Subscription.status = ACTIVE`, sets `expiresAt` (for `MONTHLY`), unlocks perks

### Subscription lifecycle

- `Subscription` model: `id, userId, planId, status, startedAt, expiresAt, lastInvoiceId, createdAt`
- States: `PENDING → ACTIVE → EXPIRED | CANCELLED`
- Daily cron in `apps/listener` flips expired subscriptions, revokes perks, optionally DMs the user via instance nsec ("your subscription expired")
- Renewal flow: user re-pays before expiry → `expiresAt` extends by interval

### Perk delivery — Vanity Lightning Address

- Premium-tier users can claim a 3–7 character vanity address (`a@domain.com`, `vip@domain.com`)
- Reuses the existing `LightningAddress` model and resolution path
- Reservation logic: vanity claims expire if subscription expires; address falls back or is freed

### Perk delivery — Sat Allowance

- `TokenAllocation` model: `id, userId, kind (SUBSCRIPTION_GRANT | MANUAL), satsRemaining, satsGranted, sourceSubscriptionId?, expiresAt, createdAt`
- Monthly cron credits `SUBSCRIPTION_GRANT` rows from active subscriptions
- Consumed by M8 Agent runs before falling back to NWC payment
- User wallet shows balance and history; never converts to spendable Lightning sats (it's a usage credit)

---

## B. Email-to-Nostr Bridge

A subscription perk that bridges incoming email into Nostr DMs.

- Each subscriber gets `<username>+inbox@<domain>` as a sub-addressed inbox
- MX is handled by an inbound provider (Resend Inbound or Amazon SES inbound)
- Provider POSTs parsed email JSON to `POST /api/email-bridge/inbound`
- `apps/web` validates the destination user has the perk active
- Forwards to `apps/listener` via PG NOTIFY → listener signs a NIP-44 DM with the instance nsec
- DM body: subject + plain-text snippet + a link back to the full message in the user dashboard
- Listener publishes the DM to the recipient's preferred relays (relay pool already held)

**Why `apps/listener`:** it already runs as a long-lived process, holds relay-pool connections, and decrypts the instance nsec for the M5 Follower Capture flow. Adding inbound-email handling is an incremental route, not a new service.

---

## C. Nostr Chat (DMs)

### Protocol stack

- **NIP-17** gift-wrapped DMs as the default (latest spec, hides metadata)
- **NIP-44** for the inner encryption
- **NIP-04** fallback for legacy clients that don't support NIP-17 yet

### Architecture

- Messages **live entirely on relays** — `apps/web` does not store message bodies
- `ChatThread` model stores per-user thread metadata only: `id, userId, counterpartyPubkey, kind (DM), lastSeenAt, muted, pinned, createdAt`
- Frontend consumes the user's preferred relays directly (NIP-65 relay list); cache-and-display pattern
- New chat surface in the user wallet: thread list, message view, compose

### Operator → User Broadcast

- Admin UI: **Communications → Broadcast** — pick a segment (active subscribers, all users, single tier), compose, preview
- Backend signs NIP-44 DMs with the **instance nsec** introduced in M5 (Follower Capture Endpoint)
- Listener publishes to recipients' preferred relays
- Rate-limited; broadcast log persisted for compliance

---

## D. Settings Extensions

Namespaced keys added to the existing `Settings` model (no migration):

- `subscriptions.enabled` — master toggle
- `subscriptions.defaultGrantSats` — default sat allowance per `MONTHLY` plan
- `email_bridge.provider` — `resend | ses | none`
- `email_bridge.inboundDomain` — MX-pointing domain
- `chat.relays` — instance default relays for chat
- `chat.allowOperatorBroadcast` — per-instance opt-in

---

## Architecture Notes

- **No new containers.** Container count stays at 3 (`web`, `listener`, `nwc-proxy`).
- `apps/web` owns the REST surface and frontend.
- `apps/listener` gains: subscription expiry cron (daily), email-bridge inbound dispatch, DM publish.
- NWC Proxy Lite (M6) is reused for all subscription invoice creation.
- M5 instance-nsec mechanism is reused for email-bridge DMs and operator broadcast.

---

## API Routes (added in M7)

- `/api/admin/subscription-plans` — `GET`, `POST` (5 routes total with `[id]`)
- `/api/subscriptions` — `GET` own list, `POST` start, `[id]` `GET` / `DELETE` (cancel)
- `/api/chat/threads` — `GET` list, `[id]` `GET` / `PATCH` (mute/pin)
- `/api/email-bridge/inbound` — webhook from email provider
- `/api/wallet/allocations` — `GET` user's allocation balance + history
- `/api/admin/communications/broadcast` — `POST` (operator broadcast)

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| Subscription plan CRUD (admin) | Operator creates a plan with price, interval, perk flags | P0 |
| Subscription purchase | Pay invoice → `Subscription.status = ACTIVE`; perk gates flip | P0 |
| Vanity LN address perk | Premium-tier user can claim a 3–7 char address | P0 |
| Sat-allowance ledger | `TokenAllocation` credited monthly; visible in user wallet | P0 |
| Email-to-Nostr bridge | Email to `alice+inbox@domain` arrives as NIP-44 DM in alice's client | P0 |
| Chat DM (NIP-17 / NIP-44) | User-user DM round-trips through user's preferred relays | P0 |
| NIP-04 fallback | Legacy clients can still receive DMs | P1 |
| Operator → user broadcast | Admin sends DM to a segment via instance nsec | P0 |
| Daily expiry cron | Expired subscriptions flip to `EXPIRED`; perks revoke | P0 |
| Renewal flow | Re-pay before expiry extends `expiresAt` | P0 |
| Settings UI for subscriptions | Toggle + default grant amount editable | P0 |
| Group chat threads (NIP-29) | Deferred to M9 / post-roadmap | — |
| Paid relay perk (nostr.wine etc.) | Deferred to post-roadmap | — |

---

## Non-goals

- No NIP-29 group chat threads (deferred to M9 / post-roadmap).
- No paid Nostr relay perk (deferred to post-roadmap; would add a 4th container).
- No Cashu eCash mint or eCash perks.
- No agent-as-a-perk wiring — M8 Agents hook into the M7 ledger, not the other way around.
