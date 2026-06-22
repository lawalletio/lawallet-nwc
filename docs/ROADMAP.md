# Roadmap

## 8-Month Development Timeline

All eight months are covered by the OpenSats grant (Fifteenth Wave, Dec 2025 – Sep 2026). The phases progress from foundation (M1–M2) through enhancement (M3–M4) and expansion (M5–M6) to monetization and intelligence (M7–M8).

| Month | Phase | Status | Key Deliverables |
|-------|-------|--------|------------------|
| 1 | Foundation | **Completed**<br/>[See report](./reports/MONTH-1) | Vitest + MSW + 154 integration tests, error hierarchy, Zod env + input validation, Pino logging, JWT auth + RBAC (4 roles), rate limiting + request limits, Next.js 16 + ESLint 9 |
| 2 | Foundation | **Completed**<br/>[See report](./reports/MONTHS-2-3) | GitHub Actions CI/CD pipeline, security scanning + coverage thresholds, Vercel config, NIP-98 → JWT session auth migration |
| 3 | Enhancement | **Completed**<br/>[See report](./reports/MONTHS-2-3) | Figma-based admin dashboard rebuild (Home/Users/Activity/Cards/Settings + shadcn/ui), responsive/mobile layout, multi-tab Settings (Branding/Wallet/Infrastructure), 8-preset theme system, branding image uploads, domain claim onboarding wizard, `lawallet.io` landing repo split, v0.9.0 release |
| 4 | Enhancement | **Completed**<br/>[See report](./reports/MONTH-4) | Monorepo migration (pnpm + Turborepo, 3 apps + 3 packages), full Admin Dashboard E2E (Cards/Designs + BoltCard QR/NFC), schema rewrite (LightningAddress 1→N + NWCConnection, IDLE/ALIAS/NWC modes), user-facing Wallet (onboarding, Send/Receive/Scan, offline cache), system-wide Activity Log + SSE, LUD-12/16/21 compliance, OpenAPI 3.1 + Scalar Playground, docs site overhaul, v0.10.0 release |
| 5 | Expansion | **In Progress** · 📊 [Presentation](./presentations/month-5.html) | **Remote Wallets first** (named `RemoteWallet` model + NWC driver; LND / CLN / BTCPay deferred), then Card System Apps (B.0 QR-based JWT login → `card-installer` Android bulk-writes/initializes cards → `card-manager` prints the Activation QR → end-user "Activate Card" flow with `SIMPLE` / `MASTER` cards + `ONE_TIME` / `FOREVER` QRs), Platform Polish (full NIP-05, relay picker, user data cache, onboarding v2 with infra-aware `.well-known` rewrites, customizable domain landing, admin home redesign, dashboard cache, PWA, bug fixes) |
| 6 | Expansion | Planned | **NWC Payment Listener** (lite, transport-only) + LUD-22 plumbing, NWC Proxy Lite settlement layer, full LUD-16/21/22 + NIP-57 closeout, **`@lawallet-nwc/react`** extraction, multi-email (Resend), Nostr scheduler, full wallet settings, deploy targets (Vercel/Netlify/Umbrel/Start9/Docker), threat model, SDK + hooks finalization |
| 7 | Monetization & Communication | Planned | **Subscription Manager** (paid tiers, monthly/one-time), perks (vanity LN address, email-to-Nostr bridge, sat allowance), **Nostr Chat DMs** (NIP-17/44), operator → user broadcast, **i18n** (en/es/pt-BR) |
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

### Month 5: Remote Wallets + Card System Apps + Platform Polish (IN PROGRESS)

See [MONTH-5.md](./roadmap/MONTH-5) and the [Month 5 presentation](./presentations/month-5.html).

Three themes executed in dependency order — Remote Wallets first because every card downstream binds to one.

- **A. Remote Wallets (Connections Manager) — ships first** — named Lightning-source connection with a `type` discriminator. **NWC driver only in M5**; LND, Core Lightning, BTCPayServer reserved (no driver this month). Existing `NWCConnection` rows migrate forward to `RemoteWallet` rows of `type = NWC`; cards and Lightning addresses bind to a `RemoteWallet` by id. Includes the **Connection Map UI** (desktop canvas + mobile tabs).
- **B. Card System Apps & Flows** — sequenced: **(B.0) QR-based JWT login** in `apps/web` (admin picks user + permissions + expiration → backend signs a JWT → renders as a QR → device scans; stateless, no revocation), (B.1) `card-installer` Android (bulk NTAG424 write against a chosen design + auth; registers each card as *initialized*), (B.2) `card-manager` (takes any initialized card and prints its Activation QR for on-demand activation; rescue / re-issue unpairs a prior owner), (B.3) end-user **"Activate Card" flow** in the wallet UI — claimer signs in as existing user or creates a fresh nsec, then branches on the QR kind. **Card kinds** (`SIMPLE` / `MASTER`) and **QR kinds** (`ONE_TIME` / `FOREVER`) are orthogonal: ONE_TIME burns and transfers card ownership; FOREVER doesn't burn and grants share access to the card holder's LAs + Remote Wallets (MASTER cards only). Max one active QR of each kind per card. (B.4) Full issue → install → activate-QR → claim → pair → pay E2E.
- **C. Platform Polish** — full NIP-05 + relay picker + user data cache; **Onboarding v2** with infrastructure detection (Cloudflare / Tunnel / Vercel / Netlify / Nginx / Caddy / Apache / direct origin) and copy-pasteable rewrite recipes for `/.well-known/lnurlp` + `/.well-known/nostr.json` + `/.well-known/verify` plus a HEAD-probe validation gate; dashboard cache; PWA Wallet; **Customizable Domain Landing** (white-label entry screen — cover + isotype + larger logo + live `you@domain` preview + optional benefits markdown step + login + continue); **Admin Home Redesign** (animated `username @ domain` hero, Lightning-address-first onboarding, Remote Wallet inline picker when none is set); **`lawallet-landing` design additions** (product screenshots, admin features section, subscription UI/UX for domain owners, per-month roadmap navigation, CRM swap); bug fixes.

### Month 6: NWC Payment Listener + NWC Proxy Lite + Lightning Compliance + Deployment

Ships the settlement-tier services (listener + proxy together), full Lightning compliance, the deferred React-hooks package, and ready-to-self-host deploy targets.

- **NWC Payment Listener (lite, transport-only)** — deferred from M5; lives in `apps/listener/`, shares the web app's Postgres via `LISTEN`/`NOTIFY` keyed on `RemoteWallet` rows of `type = NWC`; LUD-22 webhook plumbing wired through it
- **NWC Proxy Lite** — courtesy NWC settlement layer that consumes the listener's event stream
- Full LUD-16 / LUD-21 / LUD-22 closeout (with alias / redirect support)
- NIP-57 zaps end-to-end
- **`@lawallet-nwc/react`** — extract the hooks package from `apps/web/lib/client/hooks/` (deferred from M5) and publish
- Multi-email provider — Resend adapter alongside SMTP (foundation for the M7 email-to-Nostr bridge)
- Nostr scheduler (foundation for M8 agent heartbeats)
- Full wallet settings surface
- Deploy targets — Vercel, Netlify, Umbrel, Start9, Docker
- Threat model + security preparation, audit readiness
- Final SDK + React Hooks finalization

---

## Phase 4: Monetization, Communication & Intelligence (Months 7-8)

### Month 7: Monetization + Communication Plane (Subscription Manager + Nostr Chat + i18n)

Operators can charge users in sats for tier access, users can talk to each other, and the UI ships in multiple languages.

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

## Current State (as of Month 4)

Snapshot of what has shipped so far. This grows each month as deliverables land.

| Area | State |
|------|-------|
| API Routes | 47 handlers, all wrapped with error handling, Zod validation, and unified auth |
| Admin Dashboard | Full Figma rebuild — Home / Users / Activity / Cards / Designs / Settings, fully responsive |
| Wallet UI | Onboarding, Send / Receive / Scan, offline cache, NWC setup, settings |
| Landing | Split into the [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing) repo; this app redirects `/` there |
| Auth Backend | NIP-98 → JWT exchange, dual-method (`Authorization: Nostr` or `Bearer`), RBAC with 4 roles, maintenance mode |
| Testing | 578 tests across 50 files (Vitest + MSW + happy-dom), CI-enforced coverage thresholds; Playwright E2E in M5 |
| Database | 8 models — `User`, `Card`, `CardDesign`, `Ntag424`, `LightningAddress`, `AlbySubAccount`, `Settings`, `Invoice` |
| Lightning Address | LUD-12 (payer comments) and LUD-21 (verification) live; LUD-16 alias / NWC modes; LUD-22 plumbed in M6 |
| NFC Cards | Full NTAG424 encryption, scan, write, OTC activation, BoltCard QR pairing |
| Alby Integration | Sub-account management via `@getalby/sdk` v7 |
| Developer Surface | OpenAPI 3.1 spec + Scalar Playground at [beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs); TS SDK + React Hooks |
| Monorepo | pnpm workspaces + Turborepo — 3 apps (`web`, `docs`, `listener`) + 3 packages (`sdk`, `shared`, `openapi`) |

---

## Lightning Address Compliance Timeline

| Feature | Standard | Month | Status |
|---------|----------|-------|--------|
| Address management (admin) | — | 3 | ✅ Completed |
| User dashboard + npub | — | 4 | ✅ Completed |
| Payer comments | LUD-12 | 4 | ✅ Completed |
| Verify endpoint | LUD-21 | 4 | ✅ Completed |
| Address redirect | — | 5 | 🟡 In Progress |
| Base Lightning address (full) | LUD-16 | 6 | ⏳ Planned |
| Webhooks | LUD-22 | 6 | ⏳ Planned |
| Zaps | NIP-57 | 6 | ⏳ Planned |
| Courtesy NWC (Alby, LNBits, etc.) | — | 6 | ⏳ Planned |

---

## Containers Timeline

| Month | Container | Status | Service |
|-------|-----------|--------|---------|
| 4 | `lawallet-listener` | Stub in `apps/listener/` (echo) | NWC Payment Listener — added during the monorepo migration |
| 6 | `lawallet-listener` | M6: Lite (transport-only) | NWC relay monitoring + LUD-22 webhook plumbing (deferred from M5) |
| 6 | `lawallet-nwc-proxy` | M6: Lite | Courtesy NWC settlement layer for external providers |

M7 and M8 add **no new containers**. The email-to-Nostr bridge (M7) and the agent scheduler / heartbeat ticker (M8) extend `apps/listener`. Agent inference (M8) runs inside `apps/web` route handlers via the Vercel AI SDK. Container count stays at 3 (`web`, `listener`, `nwc-proxy`).
