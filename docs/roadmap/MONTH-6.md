# Month 6: NWC Payment Listener + Card Activation + Deploy Targets + Backup & Restore

**Period:** June 5 – July 5, 2026
**Status:** Completed
**Depends on:** [Month 5](MONTH-5.md)

> **Status update (2026-07):** The infrastructure tier shipped across the v1.1.0 → v1.4.0 releases — the NWC Payment Listener as a live transport service, the **SIMPLE / ONE_TIME** card activation flow (`/wallet/activate/[id]`), deploy targets (Docker Hub / Umbrel / Start9), Backup & Restore, and listener hardening. The **settlement / share / compliance** items were deferred to [Month 7](MONTH-7.md): **MASTER card account-share** (FOREVER QRs + the `CardClaim` / `LightningAddressShare` / `RemoteWalletShare` model + share-revoke), **NWC Proxy Lite**, full **LUD-16 / LUD-21 / LUD-22 / NIP-57** closeout, **`@lawallet-nwc/react`**, the **WordPress plugin**, the **Resend** adapter, and the **Nostr scheduler**. The detailed spec below is retained as the design of record for that carried-over work. See the [Month 6 report](../reports/MONTH-6.md).

## Summary

- Card activation flow (SIMPLE / MASTER cards + ONE_TIME / FOREVER QRs) — deferred from M5
- WordPress plugin (`lawallet-wordpress`) — LaWallet integration for WordPress sites
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

- Card activation flow — the end-user "Activate Card" wallet UI over SIMPLE / MASTER cards and ONE_TIME / FOREVER activation QRs, plus the activation-tokens / share data model and claim / rescue / share-revoke endpoints (deferred from M5)
- WordPress plugin (`lawallet-wordpress`) — integrate LaWallet (Lightning Address / LNURL-pay / NWC) into WordPress sites
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

## Card Activation Flow (SIMPLE / MASTER + ONE_TIME / FOREVER)

Deferred from [Month 5](MONTH-5.md), where the card apps (`card-installer`, `card-manager`) shipped. This month adds the end-user flow that turns a scanned Activation QR into a claimed card or an account share.

### Cards & QRs — two separate concepts

There are **two orthogonal concepts** in the card flow: the **card kind** (a property of the card itself) and the **QR kind** (a property of an activation token issued for a card).

**Card kinds** (declared at card creation, persisted on the `Card`):

- `SIMPLE` — single-holder card. Only ownership-transfer is supported.
- `MASTER` — account-share-capable card. Supports ownership-transfer **and** account-share grants.

**QR kinds** (a property of each `CardActivationToken`):

- `ONE_TIME` — single-use. First wallet to scan claims; token burns; subsequent scans return "already claimed". Issued for **both** SIMPLE and MASTER cards.
- `FOREVER` — multi-use. Every scan claims; token does **not** burn. Issued only for **MASTER** cards.

**Constraint — max one active QR of each kind per card:**

- A card has **at most one active `ONE_TIME` QR** at a time
- A card has **at most one active `FOREVER` QR** at a time (MASTER cards only)
- Generating a new QR of the same kind on the same card invalidates the previous one
- A MASTER card can therefore have up to **two QRs live concurrently** (one of each kind); a SIMPLE card has at most one

**Every card can re-issue a fresh QR via `card-manager` (or directly from `card-installer` at write time).** Cards transfer (or share, for MASTER) only via their own QR.

QR can be shown on screen or printed (poster mode, design-aligned).

### Card Rescue

- "Rescue this card" action invalidates any prior outstanding activation tokens for the card
- Generates a fresh `ONE_TIME` (`SIMPLE`) activation QR — card returns to a fresh, unassigned, no-attachments state
- Available on **any card** via `card-manager` — if the card had a previous owner, rescuing it unpairs that owner and readies the card for a new user. This is the standard "re-issue" path; "rescue" is just the wording when a previous QR was lost / leaked

### "Activate Card" Flow (End-User Wallet UI)

- New "Activate Card" entry in the user wallet (home-screen CTA + Settings entry)
- Wallet opens a QR scanner → reads the activation token
- **Identity step** — the claimer picks who claims:
  - **New user** — wallet creates a fresh `nsec` on the spot
  - **Existing user** — wallet signs in with NIP-07 / NIP-46 / paste nsec
- Wallet calls `POST /api/activation-tokens/[id]/claim` (NIP-98 / JWT) with the claimer's identity

Flow branches on the token's **QR kind**:

**`ONE_TIME` (ownership transfer — works for SIMPLE and MASTER cards):**

- Wallet asks the claimer which Remote Wallet should fund the card (defaults to claimer's default)
- Backend atomically: marks the token `CLAIMED`, transfers `Card.holderUserId` to the new claimer, binds `Card.remoteWalletId`, burns the token
- Previous holder's other cards / LAs / Remote Wallets stay with them — only this card moves
- Confirmation screen: card design preview + bound Remote Wallet + "ready to tap"
- A second wallet scanning the same QR sees "Already claimed"

**`FOREVER` (account share — MASTER cards only):**

- Backend records a new `CardClaim` row; token does not burn
- Claimer is granted access to **every** Lightning address and Remote Wallet owned by the card's current holder, via `LightningAddressShare` + `RemoteWalletShare` rows
- The card's ownership does not change — claimers inherit account access, not card ownership
- Card holder is not locked out — retains nsec login and canonical ownership of the card + their LAs + Remote Wallets
- Confirmation screen lists the granted resources + a "Manage shared access" entry for per-share revoke

### Data model — cards, activation tokens, shared access

```
Card {
  id            cuid
  kind          enum                 # SIMPLE | MASTER — declared at creation
  designId      cuid
  holderUserId  cuid?                # current owner (after first ONE_TIME claim)
  remoteWalletId cuid?               # bound Remote Wallet
  createdAt, updatedAt
  ...                                # NTAG424 fields, OTC state, etc.
}

CardActivationToken {
  id            cuid
  cardId        cuid
  qrKind        enum                 # ONE_TIME | FOREVER
  status        enum                 # PENDING | CLAIMED (ONE_TIME only) | REVOKED | EXPIRED
  qrPayload     string
  issuedByUserId cuid                # card holder (or operator) who minted the QR
  createdAt, expiresAt?
  claimedAt?, claimedByUserId?       # ONE_TIME only — single audit row
}
                                     # Constraint: at most one ACTIVE token per (cardId, qrKind).
                                     # FOREVER tokens only valid when Card.kind = MASTER.

CardClaim {
  id              cuid
  cardId          cuid
  claimedByUserId cuid
  claimedAt       datetime           # one row per FOREVER claim; ONE_TIME has at most one
}

LightningAddressShare {
  lightningAddressId cuid
  granteeUserId      cuid
  grantedViaCardId   cuid            # provenance — the MASTER card that granted this
  grantedAt          datetime
  revokedAt?         datetime
}

RemoteWalletShare {
  remoteWalletId   cuid
  granteeUserId    cuid
  grantedViaCardId cuid
  grantedAt        datetime
  revokedAt?       datetime
}
```

### Endpoints

- `POST /api/cards/[id]/activation-tokens` — operator (or current card holder) only; body `{ qrKind: 'ONE_TIME' | 'FOREVER' }` → `{ tokenId, qrPayload, qrKind }`. `FOREVER` rejected when `Card.kind = SIMPLE`. Replaces any prior active token of the same kind on the same card.
- `POST /api/activation-tokens/[id]/claim` — authenticated wallet user (existing or freshly created nsec); body `{ remoteWalletId? }` for ONE_TIME; returns `{ qrKind, card, grantedAccess?: { lightningAddresses[], remoteWallets[] } }`
- `POST /api/cards/[id]/rescue` — operator (or current card holder) only; invalidates outstanding tokens, returns a fresh `ONE_TIME` token
- `DELETE /api/shares/lightning-addresses/[id]` and `DELETE /api/shares/remote-wallets/[id]` — issuing user only; revokes a specific FOREVER-granted share

### Connect Card E2E (activation path)

- **Activation-QR generation** — `card-manager` takes an initialized card and prints a `ONE_TIME` QR for a `SIMPLE` card (or `card-installer` emits one at write time; MASTER + FOREVER variant in a separate branch)
- **Activate / claim** — the user scans the QR, which opens lawallet `/wallet`; the claimer creates a fresh account or signs into an existing one; ONE_TIME burns and transfers card ownership (if the card had a previous owner it is unpaired first); FOREVER grants share access without burning
- **Pair** — backend stores `(card, npub, remoteWalletId)`
- **Pay** — tap-to-pay over BoltCard NFC → LNURL-pay → invoice minted via the holder's Remote Wallet
- Playwright + simulated NFC covers the happy path; separate `FOREVER` (MASTER) claim branch asserts share rows are created and the claimer sees the granted resources
- Re-issue path covered too: `card-manager` mints a new `ONE_TIME` QR for an already-owned card, unpairing the previous holder so it can be handed off to a new user

---

## WordPress Plugin (lawallet-wordpress)

A WordPress plugin that integrates LaWallet (Lightning Address / LNURL-pay / NWC) into WordPress sites — accept Lightning payments / zaps and expose lightning addresses from a WordPress install.

- Repo: [lawallet-wordpress](https://github.com/lawalletio/lawallet-wordpress)
- Live demo: [wordpress.lawallet.io](https://wordpress.lawallet.io)
- Ships alongside the existing `integrations/WORDPRESS.md` guidance

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
| Card kinds | `Card.kind` declared at creation: `SIMPLE` (ownership transfer only) or `MASTER` (transfer + account share) | P0 |
| Activation tokens model + endpoints | `CardActivationToken.qrKind` is `ONE_TIME` or `FOREVER`; max one active token per (cardId, qrKind); FOREVER rejected on SIMPLE cards; claim enforces burn for ONE_TIME and share-grant for FOREVER | P0 |
| Card rescue / re-issue path | `POST /api/cards/[id]/rescue` invalidates outstanding tokens and issues a fresh `ONE_TIME` QR; new QR of same kind invalidates the previous on that card | P0 |
| "Activate Card" flow — `ONE_TIME` | Wallet scans QR → picks Remote Wallet → claim transfers card ownership only → token burns; second scan sees "already claimed"; claimer can be a brand-new user (fresh nsec) or an existing user | P0 |
| "Activate Card" flow — `FOREVER` (MASTER only) | Wallet scans FOREVER QR → claim succeeds without burning → claimer gains share access to card holder's LAs + Remote Wallets | P0 |
| Share revocation | Master holder can revoke a specific share per (resource, grantee) | P1 |
| Connect Card E2E (activation) | Activate-QR → claim → pair → pay; separate `FOREVER` (MASTER) branch covered; re-issue path covered (`card-manager` mints a new QR, unpairing the prior holder) | P0 |
| WordPress plugin (`lawallet-wordpress`) | Plugin integrates LaWallet (Lightning Address / LNURL-pay / NWC) into WordPress; live demo at `wordpress.lawallet.io` | P1 |
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
