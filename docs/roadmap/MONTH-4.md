# Month 4: User Wallet + Admin Dashboard E2E + Schema Rewrite (COMPLETED)

**Period:** April 5 - May 5, 2026
**Status:** Completed
**Release:** [v0.10.0](../changelogs/v0.10.0.md) (April 30, 2026)
**Progress report:** [docs/reports/MONTH-4.md](../reports/MONTH-4.md)

## Summary

Month 4 was the largest release window in the project's history. The original plan called for the User Dashboard, Courtesy NWC Proxy, wallet polish, and white-label customization. The delivered scope was significantly larger: a monorepo migration, a brand-new user-facing wallet, a complete admin dashboard build-out, a schema rewrite that unlocks per-address NWC routing, a system-wide activity log with real-time SSE, full LUD-12/16/21 compliance, an OpenAPI 3.1 spec with a live Scalar playground, and a public docs site overhaul.

The Courtesy NWC Proxy was reframed mid-month as a Bun-based **NWC notification service** on the `nostr-trigger` branch. It is feature-rich (Nostr ingest, BullMQ delivery, PG LISTEN/NOTIFY, dashboard) but not yet merged. A **lite version** will land in [Month 6](MONTH-6.md) as the LUD-16/21/22/NIP-57 settlement layer.

---

## Delivered

### Monorepo Migration (Unplanned)

- [x] pnpm workspaces + Turborepo, Node `22.14.0` via `.nvmrc`
- [x] Apps: `web`, `docs`, `listener`
- [x] Packages: `sdk`, `shared`, `openapi`
- [x] `@/*` alias re-rooted at `apps/web/`
- [x] Proxy app removed from the monorepo (external service per [NWC-PROXY.md](../services/NWC-PROXY.md))
- [x] CI rewired to `turbo`, Vercel build green

### Admin Dashboard — End-to-End ([PR #190](https://github.com/lawalletio/lawallet-nwc/pull/190))

- [x] Cards & Designs: CRUD + BoltCard QR + NFC scan flow + shape adapters
- [x] Users: list with Nostr avatars, detail page, hierarchy-aware role picker
- [x] User profile: social-style header with cover, kind-0 metadata editing, avatar/cover crop with live preview, animated upload progress, Blossom-backed image hosting
- [x] Lightning Addresses: wallet-style list + edit, primary star, alias badges, optimistic set-primary, "All users" admin toggle
- [x] Settings: persisted Branding / Wallet / Infrastructure tabs (multi-relay, multi-Blossom, SMTP)
- [x] Activity: filtered/paginated log with live SSE updates and details dialog
- [x] Community: Identity Circles dashboard widget + public Community About page

### Schema Rewrite — `LightningAddress 1→N` + `NWCConnection` (Unplanned)

- [x] Prisma schema now has 10 models (`NWCConnection` and `ActivityLog` are new)
- [x] `LightningAddress` migrated from 1:1 to 1:N with primary-address selection
- [x] Mode-aware LUD-16 resolution: `IDLE` / `ALIAS` / `NWC`
- [x] `effectiveConnectionString` exposed on detail responses
- [x] Per-address invoices feed
- [x] `users/me` exposes `effectiveNwcString`, `mode`, `username`, `redirect` for the primary address

### User-facing Wallet ([PR #191](https://github.com/lawalletio/lawallet-nwc/pull/191))

- [x] New `apps/web/app/(wallet)/...` route group
- [x] NWC client facade with offline cache (last-known balance + activity)
- [x] Persistent sign-in via localStorage
- [x] Onboarding → Home (redesigned) with balance card, primary address, recent activity
- [x] Send / Receive / Scan flows with WebLN + QR scanning
- [x] Currency switcher with split BTC/sats display
- [x] Infinite-scroll Activity backed by `activity-cache`
- [x] Unit tests for parser, contacts, balance/activity caches, and keypad

### Onboarding Flow ([PR #192](https://github.com/lawalletio/lawallet-nwc/pull/192))

- [x] Setup wizard with real domain verification + explicit endpoint URL field
- [x] Confirm-root step + community auto-import (e.g. `veintiuno.lat`)
- [x] Public `/register` route with admin bypass toggle
- [x] Paid Lightning-address registration (in-dialog, WebLN auto-pay, animated hero)
- [x] Dev-only reset endpoint for contributor workflows

### Activity Log + SSE Infrastructure (Unplanned)

- [x] `ActivityLog` DB model + permission + SSE event type
- [x] Dual-sink helper writes to Postgres and broadcasts on the SSE bus
- [x] Emit sites instrumented across USER, ADDRESS, NWC, INVOICE, CARD, SERVER
- [x] Error handler emits SERVER-class entries on uncaught failures
- [x] Admin UI with filters, pagination, live updates, details dialog
- [x] `/api/events` canonical channel for `invoices:updated`, `activity:created`, balance/status
- [x] `useApi` hook is now SWR-backed with logout teardown + invoices SSE routing
- [x] `useNwcBalance` hook for real-time balance and status

### LUD-12 / LUD-16 / LUD-21 Compliance (Pulled forward from Month 5)

- [x] Lightning address registration flow with invoice tracking
- [x] LUD-12 comment support on LUD-16 callback
- [x] LUD-21 verify endpoint for LUD-16 invoices
- [x] JWT auth accepted on lightning-addresses endpoints (not just NIP-98)
- [x] Public NWC details surfaced when connected

### White-Label Customization (Planned)

- [x] Branding tab: logo upload, theme tokens persisted globally
- [x] Blossom-backed image hosting for logos
- [x] `BrandLogotype` component with skeleton + 6 consumer migrations
- [x] Public surfaces (pre-auth) load community logotype
- [x] Infrastructure tab: multi-relays, multi-Blossom, SMTP with validation and per-section reset

### Authentication Polish (Planned)

- [x] NIP-46 bunker QR login (`nostrconnect://`)
- [x] Fix payload-length bug on NIP-04 signers

### OpenAPI 3.1 + Live API Playground ([PR #196](https://github.com/lawalletio/lawallet-nwc/pull/196), Pulled forward from Month 6)

- [x] `@lawallet-nwc/openapi` package builds the spec programmatically from per-resource path modules
- [x] `@lawallet-nwc/shared` hosts the Zod validation schemas (extracted from `apps/web/lib/validation/`)
- [x] `/api/openapi.json` route and `/api-docs` Scalar viewer
- [x] NIP-07 connected-state in the playground navbar
- [x] Roles & Permissions guide
- [x] Docs site rewired to the live API Playground (replaces static reference)

### Documentation Site Overhaul ([PR #199](https://github.com/lawalletio/lawallet-nwc/pull/199), Pulled forward from Month 6)

- [x] Sidebar restructured: Getting Started → Architecture → Guides → Deploy → Plugins → Integrations → Roadmap → Reports → Changelogs
- [x] Dedicated `deploy/` section (`docker.mdx`, `local.mdx`, `onboarding.mdx`)
- [x] `roles-and-permissions.mdx` moved under `architecture/`
- [x] `ARCHITECTURE.md` rewritten with modules, boundaries, data flows
- [x] `CONTRIBUTING.md` added with backend setup, commands, PR process
- [x] `TESTING.md` rewritten as a practical contributor guide
- [x] JSDoc on the public `lib/` surface for IDE tooltips

### Vercel Deploy Button (Unplanned)

- [x] Deploy URL points at `apps/web` with Neon Postgres integration
- [x] `prisma migrate deploy` runs during build so a fresh deploy is in a working state
- [x] ESM/CJS workspace conflict resolved (`"type": "module"` removed)

### Tooling — 22 Claude Code Agent Skills ([PR #189](https://github.com/lawalletio/lawallet-nwc/pull/189))

- [x] `.agents/skills/` library: Next.js, Prisma, Tailwind, shadcn, Vitest, TypeScript, Turborepo, Vercel, Node, frontend-design, accessibility, SEO
- [x] `skills-lock.json` for reproducibility
- [x] Referenced from `CONTRIBUTING.md`

### NWC Notification Service — Started ([`nostr-trigger` branch](https://github.com/lawalletio/lawallet-nwc/tree/nostr-trigger))

A new Bun-based microservice that replaces the listener stub. **19 commits, not yet merged.** The original Courtesy NWC Proxy specification was reframed during the period: instead of shipping a multi-provider provisioning container, the work was scoped down to a notification service that will become a **lite Courtesy NWC Proxy** in [Month 6](MONTH-6.md) — taking on the LUD-16 settlement role for NIP-57, LUD-21, and LUD-22.

- [x] Bun runtime, Docker + Turbo config
- [x] HTTP + Nostr dual control planes with shared command handlers
- [x] BullMQ job queue on Redis for retries and delivery tracking
- [x] Pool/subscription-based Nostr ingest with NIP-57 zaps
- [x] PG `LISTEN`/`NOTIFY` trigger so `NwcConnection` changes propagate without polling
- [x] Webhook payload contract for LUD-22 delivery
- [x] Self-contained dashboard with live SSE event stream
- [x] Coinos-compatible `make-invoice` flow + wallet-info probe
- [x] Kind-1 / Kind-9735 dual-kind notification dedup
- [x] `DANGEROUSLY_FREE` env flag for auth-disabled local dev
- [x] Settings tab to manage payment webhook endpoints
- [x] Unit coverage for pure modules

---

## Deferred Items

| Item | Reason | Moved To |
|------|--------|----------|
| Courtesy NWC Proxy (full, multi-provider) | Reframed mid-month as the `nostr-trigger` notification service; merge + lite settlement role targeted for M6 | Month 6 (lite version) |
| 5-provider adapters (Alby Hub / LNBits / BTCPayServer / YakiHonne / Generic NWC) | Out of scope for the lite version | Beyond M8 |
| `useCourtesyNWC` React hook | Depends on Proxy delivery | Month 6 |
| NIP-05 `.well-known/nostr.json` (with user relays + avatar) | Not implemented; profile editing landed but the public NIP-05 endpoint did not | Month 5 |
| Customizable Landing Page (admin editor) | Reframed as the public Community About page surfaced from Branding settings | Done in spirit; no separate editor |
| Playwright E2E for onboarding + admin flows | Backlogged in favor of unit + integration coverage | Month 5 / Month 6 |
| TypeScript Client SDK package coverage | `packages/sdk/` remains a stub with echo warnings | Ongoing |
| React Hooks package | Foundations landed inside the web app; extraction deferred | Month 5 |

---

## Stats

- 940 files changed, **84,100 insertions**, 5,422 deletions
- **172 commits across 13 merged PRs** ([#187](https://github.com/lawalletio/lawallet-nwc/pull/187) – [#199](https://github.com/lawalletio/lawallet-nwc/pull/199))
- Schema: 10 Prisma models (added `NWCConnection`, `ActivityLog`)
- Live deployments: [lawallet.io](https://lawallet.io), [beta.lawallet.io](https://beta.lawallet.io), [docs.lawallet.io](https://docs.lawallet.io), [beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs)
