# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LaWallet NWC is an open-source Lightning Address platform with Nostr Wallet Connect. It enables communities to provide members with lightning addresses, integrated wallets, and Nostr identity on custom domains. Built on a progressive self-custody model.

**Status**: Pre-alpha (OpenSats grant, Dec 2025–June 2026)

## Monorepo Structure

pnpm workspaces + Turborepo. Node v22.14.0 (see `.nvmrc`).

```
apps/
  web/            Next.js 16 — frontend, REST API, LUD-16 resolution (main app)
  docs/           Fumadocs + Next.js — documentation site
  proxy/          NWC Proxy — provisions courtesy NWC connections (stub, Month 4)
  listener/       NWC Payment Listener — monitors relays, dispatches webhooks (stub, Month 5)
  nostr-trigger/  Bun runtime — persistent NWC relay subscriptions, webhook + NIP-57 pipelines, dual HTTP/Nostr control plane
packages/
  prisma/         Shared Prisma schema + generated client (used by web and nostr-trigger)
  sdk/            TypeScript SDK client for the API (stub, Month 2)
  shared/         Shared types and utilities between services (stub)
```

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

### Database (from root — schema lives in packages/prisma)
```bash
pnpm --filter @lawallet-nwc/prisma run build                  # prisma generate
pnpm --filter @lawallet-nwc/prisma run db:migrate:deploy      # Run pending migrations
pnpm --filter @lawallet-nwc/prisma run db:migrate:dev         # Create new migration
pnpm --filter @lawallet-nwc/prisma run db:seed                # Seed with mock data
pnpm --filter @lawallet-nwc/prisma run db:studio              # Visual DB browser
```

## Web App Architecture (apps/web/)

### Four-Service Design
The platform consists of 4 independent containerized services:
1. **lawallet-web** (this repo) — Next.js: frontend + REST API + LUD-16
2. **lawallet-nwc-proxy** — Provisions courtesy NWC connections (separate container, stub)
3. **lawallet-listener** — Webhook-focused NWC payment listener (stub, Month 5)
4. **nostr-trigger** — Bun runtime that holds persistent Nostr relay subscriptions for every NWC, fires webhooks (BullMQ), publishes NIP-57 zap receipts, exposes dual HTTP + encrypted-Nostr control planes. Uses the shared Postgres (`@lawallet-nwc/prisma`) and its own Redis.

### Auth System (Dual Method)
- **NIP-98**: `Authorization: Nostr <base64-event>` — Nostr protocol native auth
- **JWT**: `Authorization: Bearer <jwt>` — Web-friendly tokens exchanged via POST /api/jwt
- **Unified auth**: `lib/auth/unified-auth.ts` detects method from header, resolves role via DB + Settings fallback
- **RBAC**: 4 roles (USER < VIEWER < OPERATOR < ADMIN) with granular permissions in `lib/auth/permissions.ts`
- **Admin wrappers**: `lib/admin-auth.ts` provides `withAdminAuth()` HOF for route handlers

### API Routes (apps/web/app/api/)
30 route handlers organized by resource: cards, card-designs, lightning-addresses, users, settings, jwt, lud16, admin, remote-connections. All wrapped with `withErrorHandling()` from `types/server/error-handler.ts`.

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
PostgreSQL via Prisma. Schema at `apps/web/prisma/schema.prisma`. 7 models: User, Card, CardDesign, Ntag424, LightningAddress, AlbySubAccount, Settings. Generated client at `apps/web/lib/generated/prisma`.

### Frontend
- shadcn/ui + Radix UI + Tailwind CSS 3.4
- React Hook Form + Zod for forms
- Provider hierarchy: ThemeProvider → AuthProvider → NostrProfileProvider → Toaster
- Auth context at `components/admin/auth-context.tsx` — JWT management, Nostr signer integration
- Custom hooks in `lib/client/hooks/` — useApi, useCards, useAddresses, useDesigns, useSettings
- `@/*` path alias maps to `apps/web/` root

### Open Standards
NIP-47 (NWC), NIP-05 (Nostr ID), NIP-07/46 (Nostr signing), NIP-57 (Zaps), NIP-98 (HTTP Auth), LUD-16 (Lightning Address), LUD-21/22 (Payment verification/webhooks), BoltCard (NFC)

## Testing (apps/web/)

Vitest 3.2 + MSW + happy-dom. Config at `apps/web/vitest.config.ts`.

- **Unit tests**: `tests/unit/lib/` — jwt, nostr, ntag424, errors, validation
- **Integration tests**: `tests/integration/api/` — all API routes with MSW
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
