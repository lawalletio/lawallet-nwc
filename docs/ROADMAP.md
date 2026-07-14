# Roadmap

## 8-Month Development Timeline

All eight months are covered by the OpenSats grant (Fifteenth Wave, Dec 2025 – Sep 2026). The phases progress from foundation (M1–M2) through enhancement (M3–M4) and expansion (M5–M6) to monetization and intelligence (M7–M8).

| Month | Phase | Status | Key Deliverables |
|-------|-------|--------|------------------|
| 1 | Foundation | **Completed**<br/>[See report](./reports/MONTH-1) | Vitest + MSW + 154 integration tests, error hierarchy, Zod env + input validation, Pino logging, JWT auth + RBAC (4 roles), rate limiting + request limits, Next.js 16 + ESLint 9 |
| 2 | Foundation | **Completed**<br/>[See report](./reports/MONTHS-2-3) | GitHub Actions CI/CD pipeline, security scanning + coverage thresholds, Vercel config, NIP-98 → JWT session auth migration |
| 3 | Enhancement | **Completed**<br/>[See report](./reports/MONTHS-2-3) | Figma-based admin dashboard rebuild (Home/Users/Activity/Cards/Settings + shadcn/ui), responsive/mobile layout, multi-tab Settings (Branding/Wallet/Infrastructure), 8-preset theme system, branding image uploads, domain claim onboarding wizard, `lawallet.io` landing repo split, v0.9.0 release |
| 4 | Enhancement | **Completed**<br/>[See report](./reports/MONTH-4) | Monorepo migration (pnpm + Turborepo, 3 apps + 3 packages), full Admin Dashboard E2E (Cards/Designs + BoltCard QR/NFC), schema rewrite (LightningAddress 1→N + NWCConnection, IDLE/ALIAS/NWC modes), user-facing Wallet (onboarding, Send/Receive/Scan, offline cache), system-wide Activity Log + SSE, LUD-12/16/21 compliance, OpenAPI 3.1 + Scalar Playground, docs site overhaul, v0.10.0 release |
| 5 | Expansion | **Completed**<br/>[See report](./reports/MONTH-5) | **Remote Wallets first** (named `RemoteWallet` model + NWC driver; LND / CLN / BTCPay deferred), then Card System Apps (B.0 QR-based JWT login → `card-installer` Android bulk-writes/initializes cards → `card-manager` prints the Activation QR), Platform Polish (full NIP-05, relay picker, user data cache, onboarding v2 with infra-aware `.well-known` rewrites, customizable domain landing, admin home redesign, dashboard cache, PWA, bug fixes) |
| 6 | Expansion | **Completed**<br/>[See report](./reports/MONTH-6) | **NWC Payment Listener** promoted from echo stub to a live transport service (relay pool, HMAC webhooks, missed-event recovery, never-drop retry), **card activation flow** (SIMPLE cards + ONE_TIME QRs: mint / rescue + end-user `/wallet/activate` claim UI), **deploy targets** (multi-arch Docker Hub + Umbrel + Start9), **Backup & Restore**, listener dashboard + hardening, expanded wallet settings. **Deferred to M7:** MASTER card account-share (FOREVER QRs), NWC Proxy Lite, full LUD-16/21/22 + NIP-57 closeout, `@lawallet-nwc/react` extraction, WordPress plugin, Resend adapter, Nostr scheduler |
| 7 | Monetization & Communication | In Progress | **Carried over from M6** (card activation flow, NWC Proxy Lite, compliance closeout, `@lawallet-nwc/react`, WordPress plugin, Resend, Nostr scheduler), then **Subscription Manager** (paid tiers, monthly/one-time), perks (vanity LN address, email-to-Nostr bridge, sat allowance), **Nostr Chat DMs** (NIP-17/44), operator → user broadcast, **i18n** (en/es/pt-BR) |
| 8 | Intelligence | Planned | **AI Agents** with own LN address + Nostr identity + NWC wallet (one-click spawn, dashboard funding, scheduled tasks, autonomous Nostr actions), Vercel AI Gateway router, sat-metered runs with subscriber discounts, Mode A (nsec) + Mode B (NIP-46/Amber) signing |

---

## Phase 1: Foundation (Months 1-2)

### Month 1: Backend Infrastructure + Testing (COMPLETED)

See the [Month 1 progress report](./reports/MONTH-1). Exceeded original scope. Delivered 90% of the backend infrastructure:

- Vitest + MSW + 154 integration tests covering all 32 routes
- Error handling (ApiError hierarchy + withErrorHandling)
- Configuration (Zod env validation + AppConfig)
- Pino structured logging (originally Month 2)
- JWT auth + RBAC with 4 roles (originally Month 3)
- Security middleware (rate limiting, request limits, maintenance mode)
- Zod validation for all API inputs
- Next.js 16 + ESLint 9 upgrade

### Month 2: CI/CD + Auth Flow Upgrade (COMPLETED)

See the [Months 2–3 progress report](./reports/MONTHS-2-3). Hardened the pipeline and migrated to web-friendly session auth.

- GitHub Actions CI/CD pipeline — lint, typecheck, test, build jobs in parallel
- Security scanning + coverage thresholds enforced in CI
- Vercel deploy configuration
- NIP-98 → JWT session auth migration — dual-method `Authorization: Nostr` or `Bearer` header support, JWT auto-refresh, RBAC permission resolution unified across both methods

---

## Phase 2: Enhancement (Months 3-4)

### Month 3: Admin Dashboard + Nostr Login (COMPLETED)

See the [Months 2–3 progress report](./reports/MONTHS-2-3). Full Figma-based rebuild of the admin surface with Nostr-native auth.

- Figma-based admin dashboard rebuild — Home / Users / Activity / Cards / Designs / Settings on shadcn/ui
- Responsive / mobile layout across the entire admin
- Multi-tab Settings — Branding, Wallet, Infrastructure
- 8-preset theme system with branding image uploads
- Domain claim onboarding wizard
- NIP-07 browser extension + NIP-46 remote signing + nsec login
- `lawallet.io` landing site split into the [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repo
- v0.9.0 release

### Month 4: User Wallet + Schema Rewrite + Monorepo (COMPLETED)

See the [Month 4 progress report](./reports/MONTH-4). Migrated to a monorepo, rebuilt the Lightning Address schema, and shipped the user-facing wallet.

- Monorepo migration — pnpm workspaces + Turborepo, 3 apps (`web`, `docs`, `listener`) + 3 packages (`sdk`, `shared`, `openapi`)
- Schema rewrite — `LightningAddress` 1→N, `NWCConnection`, `IDLE` / `ALIAS` / `NWC` modes
- Full Admin Dashboard E2E — Cards, Designs, BoltCard QR / NFC pairing
- User Wallet — onboarding flow, Send / Receive / Scan, offline cache
- System-wide Activity Log + Server-Sent Events for real-time updates
- LUD-12 (payer comments) and LUD-21 (verification) compliance
- OpenAPI 3.1 spec + Scalar Playground at [beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs)
- Docs site overhaul on Fumadocs, deployed to [docs.lawallet.io](https://docs.lawallet.io)
- v0.10.0 release

---

## Phase 3: Expansion (Months 5-6)

### Month 5: Remote Wallets + Card System Apps + Platform Polish (COMPLETED)

See [MONTH-5.md](./roadmap/MONTH-5).

Three themes executed in dependency order — Remote Wallets first because every card downstream binds to one.

- **A. Remote Wallets (Connections Manager) — ships first** — named Lightning-source connection with a `type` discriminator. **NWC driver only in M5**; LND, Core Lightning, BTCPayServer reserved (no driver this month). Existing `NWCConnection` rows migrate forward to `RemoteWallet` rows of `type = NWC`; cards and Lightning addresses bind to a `RemoteWallet` by id. Includes the **Connection Map UI** (desktop canvas + mobile tabs).
- **B. Card System Apps** — sequenced: **(B.0) QR-based JWT login** in `apps/web` (admin picks user + permissions + expiration → backend signs a JWT → renders as a QR → device scans; stateless, no revocation), (B.1) `card-installer` Android (bulk NTAG424 write against a chosen design + auth; registers each card as *initialized*), (B.2) `card-manager` (takes any initialized card and prints its Activation QR for on-demand activation). The end-user card **activation flow** (SIMPLE / MASTER cards, ONE_TIME / FOREVER activation QRs, claim & account-share) is scheduled for [Month 6](./roadmap/MONTH-6).
- **C. Platform Polish** — full NIP-05 + relay picker + user data cache; **Onboarding v2** with infrastructure detection (Cloudflare / Tunnel / Vercel / Netlify / Nginx / Caddy / Apache / direct origin) and copy-pasteable rewrite recipes for `/.well-known/lnurlp` + `/.well-known/nostr.json` + `/.well-known/verify` plus a HEAD-probe validation gate; dashboard cache; PWA Wallet; **Customizable Domain Landing** (white-label entry screen — cover + isotype + larger logo + live `you@domain` preview + optional benefits markdown step + login + continue); **Admin Home Redesign** (animated `username @ domain` hero, Lightning-address-first onboarding, Remote Wallet inline picker when none is set); **`lawallet-landing` design additions** (product screenshots, admin features section, subscription UI/UX for domain owners, per-month roadmap navigation, CRM swap); bug fixes.

### Month 6: NWC Payment Listener + Deploy Targets + Backup & Restore (COMPLETED)

See [MONTH-6.md](./roadmap/MONTH-6) and the [Month 6 report](./reports/MONTH-6). The infrastructure tier landed across the v1.1.0 → v1.4.0 releases; the card-activation / settlement / compliance layer was deferred to [Month 7](./roadmap/MONTH-7).

**Delivered:**

- **NWC Payment Listener (transport-only)** — the `apps/listener/` echo stub became a live service: one `NWCClient` per active NWC `RemoteWallet`, HMAC-signed webhooks to `apps/web`, relay-pool reconciliation via Postgres `LISTEN`/`NOTIFY`, missed-event catch-up, and indefinite never-drop webhook retry with backoff
- **Card activation flow (SIMPLE + ONE_TIME)** — `Card.kind` + `CardActivationToken` model, mint / list activation tokens, `POST /api/cards/[id]/rescue` re-issue, and the end-user `/wallet/activate/[id]` claim UI (ONE_TIME burns and transfers card ownership). MASTER account-share is reserved (see Deferred)
- **Listener dashboard + hardening** — realtime status, sortable/paginated event tables, event detail modal, a `/status` endpoint that never 500s, keep-alive guards, and dead-LNCurl auto-archival
- **Deploy targets** — multi-arch `masize/lawallet-nwc{,-listener}` images on Docker Hub via CI, Umbrel app-store auto-update, and a published Start9 / StartOS `.s9pk` package
- **Backup & Restore** — Settings ▸ Backup & Restore: `fflate` zip export/import of 14 models with optional AES-256-GCM encryption and analyze / merge / replace import modes (ADMIN-only)
- **Wallet + admin polish** — expanded wallet settings and payment flows, primary wallet follows primary address, sat symbol component, admins can grant the ADMIN role, admins view any Lightning address read-only

**Deferred to [Month 7](./roadmap/MONTH-7):**

- **MASTER card account-share** — FOREVER QRs + the `CardClaim` / `LightningAddressShare` / `RemoteWalletShare` data model + share-revoke endpoints (the `MASTER` / `FOREVER` enum values are reserved in the schema but not yet implemented)
- **NWC Proxy Lite** settlement layer + full **LUD-16 / LUD-21 / LUD-22 / NIP-57** closeout (LUD-22 webhook *transport* already ships via the listener; the spec closeout does not)
- **`@lawallet-nwc/react`** hooks package extraction
- **WordPress plugin** (`lawallet-wordpress`), **Resend** email adapter, **Nostr scheduler**, threat model + security-audit prep, Vercel / Netlify deploy configs

---

## Phase 4: Monetization, Communication & Intelligence (Months 7-8)

### Month 7: Monetization + Communication Plane (Subscription Manager + Nostr Chat + i18n) — IN PROGRESS

The active window. Operators can charge users in sats for tier access, users can talk to each other, and the UI ships in multiple languages — after the settlement / compliance work carried over from Month 6 lands first.

**Carried over from Month 6 (do first):**

- **MASTER card account-share** — the FOREVER-QR flow on top of the shipped SIMPLE / ONE_TIME activation: `CardClaim` / `LightningAddressShare` / `RemoteWalletShare` model + claim / share-revoke endpoints
- **NWC Proxy Lite** settlement layer + full **LUD-16 / LUD-21 / LUD-22 / NIP-57** closeout
- **`@lawallet-nwc/react`** hooks package extraction; **WordPress plugin**; **Resend** email adapter (foundation for the email-to-Nostr bridge below); **Nostr scheduler**; threat model + security-audit prep; Vercel / Netlify deploy configs

**Month 7 scope:**

- **Subscription Manager** — operator-defined plans with monthly or one-time pricing in sats
- **Perks (P0):** vanity Lightning address, email-to-Nostr bridge, sat allowance credited monthly
- **Nostr Chat — DMs** (NIP-17 gift-wrapped over NIP-44, NIP-04 fallback) with relay-only message storage
- **Email-to-Nostr bridge** — `username+inbox@domain.com` MX route delivered as NIP-44 DMs (built on the M6 Resend adapter)
- **Operator → user broadcast** via instance nsec, segmented by tier
- **Daily expiry cron** for subscription lifecycle, runs in `apps/listener`
- **Internationalization (i18n)** — `next-intl`, locales at launch: `en`, `es`, `pt-BR`; per-user + operator-default locale resolution
- **M5 rename:** legacy "Subscription Manager (admin)" follower-capture endpoint becomes "Follower Capture Endpoint" to free the name for the M7 paid-tier feature

See [MONTH-7.md](./roadmap/MONTH-7).

### Month 8: Intelligence Plane (AI Agents)

Operators spawn AI agents with full identity and a wallet; users pay in sats with subscriber discounts.

- **One-click agent spawn** from the dashboard — generates Nostr keypair, provisions `<slug>@domain.com` LN address, creates an NWC wallet via the M6 Proxy
- **Per-agent funding** — operator clicks "Fund Agent", pays an invoice from their wallet, agent balance updates
- **Identity Mode A (autonomous)** — server-side encrypted nsec; agent signs Nostr events directly
- **Identity Mode B (delegated)** — NIP-46 bunker URI (Amber) for human-approved signing
- **Heartbeats / scheduled tasks** — cron-driven `POST`, `REPLY_TO_MENTIONS`, `ZAP_LIST`, `CUSTOM_PROMPT` task types
- **Autonomous Nostr actions** — agents post, react, follow, zap, and DM via their own identity and wallet
- **Sat-metered runs** — `POST /api/agents/[id]/run` debits the user's M7 allowance; falls back to a 402-style invoice from the agent's wallet
- **Reference agents:** Drafter + Summarizer + custom OperatorBot
- **Vercel AI SDK + AI Gateway** as the model router, running inside `apps/web` route handlers (no new container)

See [MONTH-8.md](./roadmap/MONTH-8).

---

## Beyond M8

Group chat threads (NIP-29), operator-hosted paid Nostr relay (strfry/khatru), Cashu eCash mint, and the community plugin family (Events, Badges, Commerce) live in [VISION.md](./VISION.md) under "Beyond M8 / Community Vision".

---

## Current State (as of v1.4.0)

Snapshot of what has shipped so far. This grows each month as deliverables land.

| Area | State |
|------|-------|
| API Routes | 79 route handlers, all wrapped with error handling, Zod validation, and unified auth |
| Admin Dashboard | Full Figma rebuild — Home / Users / Activity / Cards / Designs / Settings, fully responsive |
| Wallet UI | Onboarding, Send / Receive / Scan, offline cache, NWC setup, full settings; **PWA installable** with offline service worker; **Activate Card** flow |
| Remote Wallets | `RemoteWallet` model + pluggable NWC driver + Connection Map UI (desktop canvas + mobile tabs); LNCurl disposable wallets |
| NWC Listener | Live transport service in `apps/listener/` — relay pool, HMAC webhooks, missed-event recovery, never-drop retry, realtime dashboard |
| Landing | Split into the [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repo; this app redirects `/` there |
| Auth Backend | NIP-98 → JWT exchange, dual-method (`Authorization: Nostr` or `Bearer`), RBAC with 4 roles, maintenance mode |
| Testing | 108 unit/integration test files (Vitest + MSW + happy-dom) + 8 Playwright E2E specs, CI-enforced coverage thresholds |
| Database | 15 Prisma models incl. `User`, `LightningAddress`, `RemoteWallet`, `Card`, `CardActivationToken`, `CardPaymentAttempt`, `CardDesign`, `Ntag424`, `ActivityLog`, `PluginRecord`, `NostrProfileCache`, `Settings`, `Invoice` |
| Lightning Address | LUD-12 (comments) + LUD-21 (verify) live; LUD-16 alias / NWC modes; NIP-05 (`.well-known/nostr.json`); LUD-22 webhook *transport* via listener — full LUD-16/22 + NIP-57 closeout in M7 |
| NFC Cards | Full NTAG424 encryption, scan, write, OTC activation, BoltCard QR pairing, SIMPLE/ONE_TIME activation tokens |
| Backup & Restore | ADMIN zip export/import of 14 models with optional AES-256-GCM encryption (merge / replace modes) |
| Deploy | Multi-arch Docker Hub images, Umbrel app-store auto-update, published Start9 `.s9pk`, installer CLI |
| Plugins | In-codebase plugin system (`apps/web/plugins/`) with a `badges` reference plugin; `pnpm plugin:new` scaffold |
| Alby Integration | Sub-account management via `@getalby/sdk` v7 |
| Developer Surface | OpenAPI 3.1 spec + Scalar Playground at [beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs); TS SDK + `@lawallet-nwc/react` extraction in M7 |
| Monorepo | pnpm workspaces + Turborepo — 4 apps (`web`, `docs`, `listener`, `cli`) + 3 packages (`sdk`, `shared`, `openapi`) |

---

## Lightning Address Compliance Timeline

| Feature | Standard | Month | Status |
|---------|----------|-------|--------|
| Address management (admin) | — | 3 | ✅ Completed |
| User dashboard + npub | — | 4 | ✅ Completed |
| Payer comments | LUD-12 | 4 | ✅ Completed |
| Verify endpoint | LUD-21 | 4 | ✅ Completed |
| Address redirect | — | 5 | ✅ Completed |
| Base Lightning address | LUD-16 | 4 | ✅ Completed (mode-aware resolver) |
| Webhooks | LUD-22 | 6 → 7 | 🟡 Transport shipped via listener; spec closeout in M7 |
| Zaps | NIP-57 | 7 | ⏳ Planned |
| Courtesy NWC (Proxy Lite) | — | 7 | ⏳ Planned |

---

## Containers Timeline

| Month | Container | Status | Service |
|-------|-----------|--------|---------|
| 4 | `lawallet-listener` | Stub in `apps/listener/` (echo) | NWC Payment Listener — added during the monorepo migration |
| 6 | `lawallet-listener` | ✅ Live (transport-only) | NWC relay pool + HMAC payment webhooks + missed-event recovery (v1.1.0) |
| 7 | `lawallet-nwc-proxy` | ⏳ Planned (Lite) | Courtesy NWC settlement layer for external providers (carried over from M6) |

The **NWC Proxy** (carried into M7) is the last new container; M8 adds none. The email-to-Nostr bridge (M7) and the agent scheduler / heartbeat ticker (M8) extend `apps/listener`. Agent inference (M8) runs inside `apps/web` route handlers via the Vercel AI SDK. Container count settles at 3 (`web`, `listener`, `nwc-proxy`).
