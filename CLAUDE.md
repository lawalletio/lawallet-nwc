# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LaWallet NWC is an open-source Lightning Address platform with Nostr Wallet Connect. It enables communities to provide members with lightning addresses, integrated wallets, and Nostr identity on custom domains. Built on a progressive self-custody model.

**Status**: Pre-alpha (OpenSats grant, Dec 2025–June 2026)

## Monorepo Structure

pnpm workspaces + Turborepo. Node v22.14.0 (see `.nvmrc`).

```
apps/
  web/          Next.js 16 — frontend, REST API, LUD-16 resolution (main app)
  docs/         Fumadocs + Next.js — documentation site
  listener/     NWC Payment Listener — monitors relays, dispatches webhooks (stub with echo warnings; see docs/services/NWC-LISTENER.md)
packages/
  sdk/          TypeScript SDK client for the API (stub with echo warnings)
  shared/       Shared types and utilities between services (stub)
```

The NWC Proxy is no longer vendored here — it will be provisioned as an **external** service via LNURL (see `docs/services/NWC-PROXY.md`).

## Issue & Branch Workflow

**Every issue addressed must have its own branch, created from the issue.** This auto-links the branch to the issue in GitHub's Development panel and keeps the **LaWallet v2** project board (org project #10) status (`Todo → In progress → Done`) in sync.

### Start an issue
Always create the branch via `gh issue develop` — never `git checkout -b` — so the branch is auto-linked and based on the latest `main`:
```bash
gh issue develop <n> --base main -c                          # auto-named branch
gh issue develop <n> --base main -n feat/<n>-<slug> -c       # custom name
```
Immediately open a **draft PR** (before any commits) so the project card moves `Todo → In progress` via the project's built-in "Pull request opened" workflow:
```bash
gh pr create --draft --base main --title "wip(#<n>): <short title>" --body "Closes #<n>"
```
Always include `Closes #<n>` (or `Fixes`/`Resolves`) in the PR body so the issue auto-closes on merge.

### Finish an issue
Push commits → mark PR ready for review → merge. On merge: the issue auto-closes, the project card auto-moves `In progress → Done`, and the branch is deleted (GitHub prompts on merge).

### Sub-issues of an epic
For an epic with sub-issues (e.g. #263 with sub-issues #231-#236):
- Each sub-issue gets its own branch via `gh issue develop <sub-n> --base feat/<epic-n>-... -n feat/<sub-n>-<slug> -c`.
- Sub-issue PRs target the **epic branch** (`--base feat/<epic-n>-...`), not `main`.
- The epic branch merges to `main` only when the epic is complete.
- When the sub-branch is created from the epic, it starts at the same commit as the epic, so opening a draft PR fails with `No commits between ...`. Seed it first:
  ```bash
  git commit --allow-empty -m "chore(#<sub-n>): start <topic>"
  git push origin feat/<sub-n>-<slug>
  ```
  Then `gh pr create --draft --base feat/<epic-n>-... ...`.

### Do not
- Do not start work without an issue — open one first.
- Do not create branches manually (`git checkout -b`) — they won't auto-link to the issue.
- Do not push to `main` directly.
- Do not delete a branch with unmerged work — verify it's merged to its base (epic or `main`) first.

### Project board auto-workflows (one-time setup)
Status transitions above rely on built-in workflows in the **LaWallet v2** project. Enable these at https://github.com/orgs/lawalletio/projects/10/workflows:
- **Pull request linked to issue** → Status: `In progress`
- **Pull request merged** → Status: `Done`
- **Item closed** → Status: `Done`

If any of these are disabled, manually drag the card on the project board when starting/finishing an issue.

## Commands

### Workspace-level (from repo root)
```bash
pnpm install                    # Install all workspace dependencies
pnpm build                      # Build all packages via turbo
pnpm dev                        # Dev servers for all apps
pnpm lint                       # Lint all packages
pnpm typecheck                  # Type check all packages
pnpm test                       # Test all packages
pnpm format                     # Prettier format all files
```

### Filtered (single app/package)
```bash
pnpm --filter @lawallet-nwc/web dev          # Dev server on :3000
pnpm --filter @lawallet-nwc/web build        # Production build
pnpm --filter @lawallet-nwc/web test         # Run all tests
pnpm --filter @lawallet-nwc/web test -- tests/unit/lib/jwt.test.ts   # Single test file
pnpm --filter @lawallet-nwc/web test:coverage  # Tests with coverage
pnpm --filter @lawallet-nwc/web typecheck    # Type check web only
pnpm --filter @lawallet-nwc/docs dev         # Docs dev server
```

### Database (run from apps/web/)
```bash
cd apps/web
pnpm exec prisma generate        # Generate Prisma client
pnpm exec prisma migrate deploy  # Run pending migrations
pnpm exec prisma migrate dev     # Create new migration
pnpm exec prisma db seed         # Seed with mock data
pnpm exec prisma studio          # Visual DB browser
```

## Web App Architecture (apps/web/)

### Three-Service Design
The platform consists of 3 independent services with no shared infrastructure:
1. **lawallet-web** (this repo) — Next.js: frontend + REST API + LUD-16
2. **lawallet-nwc-proxy** — External service that provisions courtesy NWC connections via LNURL (not vendored here; see `docs/services/NWC-PROXY.md`)
3. **lawallet-listener** — Monitors NWC relays, dispatches LUD-22 webhooks (stub in `apps/listener/`; see `docs/services/NWC-LISTENER.md`)

### Auth System (Dual Method)
- **NIP-98**: `Authorization: Nostr <base64-event>` — Nostr protocol native auth
- **JWT**: `Authorization: Bearer <jwt>` — Web-friendly tokens exchanged via POST /api/jwt
- **Unified auth**: `lib/auth/unified-auth.ts` detects method from header, resolves role via DB + Settings fallback
- **RBAC**: 4 roles (USER < VIEWER < OPERATOR < ADMIN) with granular permissions in `lib/auth/permissions.ts`
- **Admin wrappers**: `lib/admin-auth.ts` provides `withAdminAuth()` HOF for route handlers

### API Routes (apps/web/app/api/)
34 route handlers organized by resource: `cards`, `card-designs`, `lightning-addresses`, `users`, `settings`, `jwt`, `lud16`, `admin`, `root`, `remote-connections`, `invoices`, `events` (SSE). All wrapped with `withErrorHandling()` from `types/server/error-handler.ts`. The public `lud16/` endpoints support **LUD-12** (payer comments) and **LUD-21** (payment verification).

### Middleware Stack
- **Error handling**: `types/server/error-handler.ts` — catches errors, returns structured JSON
- **Rate limiting**: `lib/middleware/rate-limit.ts` — in-memory, configurable per endpoint
- **Request limits**: `lib/middleware/request-limits.ts` — body size validation
- **Validation**: `lib/validation/middleware.ts` — Zod schema validation for body/query/params
- **Maintenance**: `lib/middleware/maintenance.ts` — global maintenance toggle

### Error Hierarchy
All errors extend `ApiError` in `types/server/errors.ts`:
ValidationError(400), AuthenticationError(401), AuthorizationError(403), NotFoundError(404), ConflictError(409), PayloadTooLargeError(413), TooManyRequestsError(429), ServiceUnavailableError(503)

### Database
PostgreSQL via Prisma. Schema at `apps/web/prisma/schema.prisma`. 8 models: User, Card, CardDesign, Ntag424, LightningAddress, AlbySubAccount, Settings, Invoice. Generated client at `apps/web/lib/generated/prisma`.

### Frontend
- shadcn/ui + Radix UI + Tailwind CSS 3.4
- React Hook Form + Zod for forms
- Provider hierarchy: ThemeProvider → AuthProvider → NostrProfileProvider → Toaster
- Auth context at `components/admin/auth-context.tsx` — JWT management, Nostr signer integration
- Custom hooks in `lib/client/hooks/` — `useApi`, `useCards`, `useAddresses`, `useDesigns`, `useSettings`, `useActivity`, `useHomeStats`, `useSse`; plus `useNwcBalance` in `lib/client/`
- Admin Settings page is split into tabs: `wallet-tab`, `branding-tab`, `infrastructure-tab`. Branding/theme tokens are persisted globally via `/api/settings` and applied platform-wide.
- `@/*` path alias maps to `apps/web/` root

### Real-time (SSE)
- `app/api/events/` emits server-sent event streams for live updates
- `lib/client/hooks/use-sse.ts` is the generic SSE client hook
- `lib/client/use-nwc-balance.ts` demonstrates the pattern — powers the dashboard NWC card's real-time balance and status

### Open Standards
NIP-47 (NWC), NIP-05 (Nostr ID), NIP-07/46 (Nostr signing), NIP-57 (Zaps), NIP-98 (HTTP Auth), LUD-16 (Lightning Address), LUD-21/22 (Payment verification/webhooks), BoltCard (NFC)

## Testing (apps/web/)

Vitest 3.2 + MSW + happy-dom. Config at `apps/web/vitest.config.ts`.

- **Unit tests**: 16 files in `tests/unit/lib/` — auth, config, env, errors, jwt, logger, maintenance, nip98, nostr, permissions, rate-limit, unified-auth, utils, validation, public-URL
- **Integration tests**: 23 files in `tests/integration/api/` — all API routes (cards, card-designs, users, addresses, settings, invoices, remote-connections, lud16, lud21-verify, jwt, admin-assign) with MSW
- **Setup**: `tests/setup.ts` starts MSW server
- **Helpers**: `tests/helpers/` — auth-helpers, api-helpers, fixtures, route-helpers

### Key Testing Patterns
- Mock config: `vi.mock('@/lib/config')`, mock DB: `vi.mock('@/lib/prisma')`
- For config/env tests: `vi.resetModules()` + dynamic `import()` to bust cache
- Prisma mock uses `createModelMock()` per model; call `resetPrismaMock()` in beforeEach
- For Next.js App Router params: use `createParamsPromise()` from route-helpers
- `vi.clearAllMocks()` only clears calls; `mockReset()` also clears return values
- Logger module calls `getConfig()` at module load — mock config BEFORE import

### Coverage Thresholds
statements: 60%, branches: 75%, functions: 70%, lines: 60%

## Code Style

Prettier: no semicolons, single quotes, no trailing commas, arrow parens: avoid. ESLint: Next.js core-web-vitals.

## Environment Variables (apps/web/.env)

Required: `DATABASE_URL`, `JWT_SECRET` (32+ chars). See `apps/web/.env.example` for all options including `ALBY_API_URL`, `ALBY_BEARER_TOKEN`, `LOG_LEVEL`, `MAINTENANCE_MODE`.

## Deployment

- **Docker**: `docker compose up` from root (builds apps/web, starts PostgreSQL)
- **Vercel**: Set Root Directory to `apps/web` in Vercel dashboard
- **Standalone**: `apps/web/Dockerfile` produces standalone Next.js output
- Targets planned: Umbrel, Start9, Netlify (Month 6)

## Docs App (apps/docs/)

Fumadocs v16 + Next.js 16 + Tailwind CSS v4. Content in `apps/docs/content/docs/` as MDX files. Sidebar configured via `meta.json` files. Interactive code examples via Sandpack.

## Roadmap Reference

See `docs/ROADMAP.md` for the 6-month plan. Architecture details in `docs/ARCHITECTURE.md`. Testing strategy in `docs/TESTING.md`.
