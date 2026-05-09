# Month 6: NWC Proxy Lite + Lightning Compliance + Deployment

**Period:** June 5 – July 5, 2026
**Status:** Planned
**Depends on:** [Month 5](MONTH-5.md) (Card System + Listener Lite + Platform Polish)

## Summary

The final grant month transitions LaWallet NWC from active development to a deployable, audit-ready platform. The headline deliverable is the **NWC Proxy Lite** — built on top of the listener merged in Month 5, it becomes the **LUD-16 settlement layer** and ships full LUD-16 / LUD-21 / LUD-22 / NIP-57 compliance. Around it, the Nostr scheduler, full wallet settings, deployment targets (Vercel / Netlify / Umbrel / Start9 / Docker), security audit prep, and SDK + hooks finalization close out the OpenSats grant scope.

> Most LUD-12 / LUD-16 / LUD-21 work already shipped in Month 4 via the mode-aware resolver. Month 6 finalizes spec compliance through the Proxy and adds NIP-57 zaps + LUD-22 webhooks.

---

## Goals

- NWC Proxy Lite — settlement layer that provides LUD-16, NIP-57, LUD-21, LUD-22
- Full LUD-16, LUD-21, LUD-22 + NIP-57 compliance (closeout)
- Nostr scheduler (pre-sign Nostr posts; cron-dispatched via the listener)
- Full Wallet settings (theme, notifications, default currency, contact list)
- Deployment targets: Vercel, Netlify, Umbrel, Start9, Docker Compose
- Documentation finalization (service docs, threat model, migration guides)
- SDK + Hooks finalization
- Security audit readiness

---

## NWC Proxy Lite (Settlement Layer)

The `nostr-trigger` service merged in Month 5 already exposes a Coinos-compatible `make-invoice` flow and a wallet-info probe. Month 6 promotes that surface into the **Proxy Lite** — the settlement engine for inbound Lightning payments to LaWallet addresses.

### Role

When a payer hits `username@domain.com`:

1. `apps-web` resolves the address and returns LUD-16 metadata
2. On the LNURL-pay callback, `apps-web` asks the **Proxy** to mint an invoice on behalf of the holder's NWC connection
3. Proxy creates the invoice (via NWC `make_invoice`), returns it
4. When the payment lands, the listener forwards the event to `apps-web`, which dispatches LUD-22 webhooks and emits NIP-57 zap receipts as needed

### What "Lite" Means

- Single-tenant — runs alongside the listener (or as the same process in lite deployments)
- No multi-provider adapter layer (the original M4 plan's Alby/LNBits/BTCPay/YakiHonne adapters land **beyond M8**)
- Uses the holder's existing NWC connection — no provisioning of new courtesy wallets

### Compliance delivered through the Proxy

- **LUD-16** — `.well-known/lnurlp/<username>` finalized per spec, including `allowsNostr` + `nostrPubkey`
- **NIP-57** — kind 9735 zap-receipt minting + verification
- **LUD-21** — `verify` URL on every invoice; status check endpoint
- **LUD-22** — webhook subscription dispatched on payment receipt (plumbing landed in M5; M6 adds spec-correct payload, signature, and retry policy)

---

## Lightning Address Compliance Closeout

| Standard | M4 status | M6 closeout work |
|----------|-----------|------------------|
| LUD-12 (comments) | ✅ shipped | — |
| LUD-16 (lightning address) | ✅ mode-aware resolver | Polish `.well-known/lnurlp` schema, finalize metadata |
| LUD-21 (verify) | ✅ endpoint shipped | Tighten edge cases (expired, double-pay), add status enum |
| LUD-22 (webhooks) | 🚧 plumbing in M5 | Spec-correct payload, signature, retry + DLQ |
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

## Nostr Scheduler

A pre-sign + dispatch pattern for scheduled Nostr posts.

- Admin pre-signs Nostr events (kind:1 by default, configurable) with the instance nsec
- Events stored with a `scheduledAt` timestamp
- Cron job in the listener service publishes them at the scheduled time (the listener already holds relay connections)
- Admin UI: compose, schedule, list pending, cancel

Built on top of the instance-nsec mechanism introduced in M5 for the Subscription Manager.

---

## Full Wallet Settings

Complete the user-wallet settings surface introduced in M4:

- Theme preference (light / dark / system) — already in admin; add to wallet
- Notification settings (which payment events trigger UI notifications)
- Default currency (sats / BTC / fiat with selectable currency)
- Contact list (add / edit / export contacts kept in `contacts-store`)
- Privacy settings (reveal balance, hide address)
- Connected NWC management (list, switch, revoke)

---

## Deployment Targets

### Vercel
- `vercel.json` already validated in Month 4
- Confirm one-click deploy still works after M5/M6 changes
- Document env-var mapping for Listener + Proxy (deployed separately)

### Netlify
- `netlify.toml` for the Next.js app (`apps/web`)
- Build command, output dir, redirect rules
- Document the same multi-service caveat (Netlify hosts web only)

### Umbrel
- Update the `umbrel-app-store` package to include all 3 containers (`web` + `listener` + `proxy`, where `listener` and `proxy` may be one image deployed twice)
- Comprehensive configuration options
- Installation walkthrough in the docs site

### Start9
- Embassy service wrapper with all 3 services
- Manifest, health checks
- Submission to Start9 registry

### Docker Compose
- Production `docker-compose.yml` with reverse proxy (Traefik recommended)
- SSL/TLS guide (Let's Encrypt + Traefik)
- Volume layout, backup strategy
- Single-host deployment story for self-hosters

---

## Documentation Finalization

### API Docs

OpenAPI 3.1 already deployed in Month 4 at [beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs). Closeout work:

- Examples on every endpoint
- Auth diagrams (NIP-98 → JWT exchange)
- Webhook payload reference (LUD-22 + Subscription Manager)

### Service Docs

- `NWC-LISTENER.md` — already rewritten in M5 for the transport-only role; verify
- `NWC-PROXY.md` — rewritten to describe the Lite settlement role (single-tenant, no multi-provider adapters)

### Threat Model + Crypto Operations

Audit prep document covering:

- NWC encryption (NIP-47)
- NTAG424 chip encryption (AES-CMAC)
- Webhook HMAC-SHA256 signing
- JWT generation + verification
- Instance nsec handling (encrypted DB storage)
- Nostr signing flows (NIP-07 / NIP-46)

### Migration Guide

Document any schema changes since v0.10.0; provide migration steps for self-hosters running the M4 release.

---

## SDK + Hooks Finalization

- `@lawallet-nwc/sdk` from stub workspace to full client (currently a stub with echo warnings — see [SDK.md](../SDK.md))
- `@lawallet-nwc/react` reference docs (the package itself extracted in M5)
- Code snippets per hook in the docs site
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
| NWC Proxy Lite | Mints invoices via NWC; LUD-16 callback returns Proxy invoice | P0 |
| LUD-16 closeout | `.well-known/lnurlp` spec-correct, `allowsNostr` + `nostrPubkey` set | P0 |
| LUD-21 closeout | Verify endpoint covers all payment states | P0 |
| LUD-22 closeout | Spec-correct payload + HMAC + retry policy | P0 |
| NIP-57 zaps | Zap receipts created and verified, tested with Damus/Amethyst/Primal | P0 |
| Nostr scheduler | Admin can compose + schedule kind:1 / kind:4; cron dispatches them | P1 |
| Full Wallet settings | Theme, notifications, currency, contacts, privacy, NWC mgmt | P1 |
| Vercel | One-click deploy still green | P1 |
| Netlify | `netlify.toml` validated, web app deploys | P1 |
| Umbrel | All 3 containers in app store, installable | P0 |
| Start9 | Embassy package submitted | P1 |
| Docker Compose | Production compose + reverse proxy + SSL guide | P0 |
| Service docs | `NWC-LISTENER.md` + `NWC-PROXY.md` reflect Lite reality | P0 |
| Threat model | Crypto operations + attack surfaces documented | P1 |
| SDK | `@lawallet-nwc/sdk` published, no stub warnings | P1 |
| Security audit prep | Inventory + audit + lint + PR template | P1 |
