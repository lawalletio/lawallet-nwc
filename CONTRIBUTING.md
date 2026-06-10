# Contributing to LaWallet NWC

Thanks for your interest in contributing! This guide walks through getting the
backend running locally, the commands you'll use day-to-day, and the workflow
we follow for pull requests.

> **Status:** Pre-alpha (OpenSats grant, Dec 2025–June 2026). Expect breaking
> changes — coordinate larger changes via an issue before opening a PR.

---

## Table of Contents

- [Project Layout](#project-layout)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Database & Migrations](#database--migrations)
- [Common Commands](#common-commands)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Debugging Tips](#debugging-tips)
- [Where to Get Help](#where-to-get-help)

---

## Project Layout

This is a pnpm + Turborepo monorepo. The backend lives in `apps/web/` (Next.js
App Router with REST API + LUD-16 resolution).

```
apps/
  web/        Next.js 16 — frontend, REST API, LUD-16 resolution (main app)
  docs/       Fumadocs site
  listener/   NWC Payment Listener (stub)
packages/
  sdk/        TypeScript SDK client (stub)
  shared/     Shared types & utilities (stub)
```

For deeper architectural context, read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
before working on anything non-trivial.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | `v22.14.0` | Pinned in [`.nvmrc`](./.nvmrc); `nvm use` to match |
| pnpm | `10.11.0` | Pinned via `packageManager` field in [`package.json`](./package.json) |
| PostgreSQL | 15+ | Use the bundled `docker-compose.yml` if you don't have one running |
| Git | any recent | Hooks rely on a normal `pre-commit`-friendly setup |

If you have [Corepack](https://nodejs.org/api/corepack.html) enabled, pnpm
will be activated automatically. Otherwise install it with
`npm install -g pnpm@10.11.0`.

---

## Local Setup

### Fast path (one command)

```bash
git clone https://github.com/lawalletio/lawallet-nwc.git
cd lawallet-nwc
pnpm start:dev-server
```

[`scripts/dev-worktree.mjs`](./scripts/dev-worktree.mjs) installs dependencies,
writes local env files (`.env.development.local` + `apps/web/.env.local`) with
a generated `JWT_SECRET`, starts an **isolated per-checkout Postgres** (its own
compose project, port, and volume), migrates the database — seeding it only
when fresh — and serves the admin at the printed URL. Related commands:

```bash
pnpm dev:setup      # same bootstrap, without launching the dev server
pnpm dev:env        # only (re)write the env files — never overwrites values
pnpm dev:db:reset   # explicit destructive reset + reseed of this checkout's DB
```

Every git worktree gets its own database, ports, and env automatically, so
parallel checkouts never collide (see
[Multi-worktree local databases](#multi-worktree-local-databases) for the
lighter shared-Postgres alternative).

### Manual path (step by step)

```bash
# 1. Clone and enter the repo
git clone https://github.com/lawalletio/lawallet-nwc.git
cd lawallet-nwc

# 2. Use the pinned Node version
nvm use

# 3. Install workspace dependencies (runs `prisma generate` automatically)
pnpm install

# 4. Configure environment variables
cp apps/web/.env.example apps/web/.env
# The default DATABASE_URL matches the bundled docker-compose Postgres.
# Generate and set a JWT_SECRET (32+ chars) in apps/web/.env:
#   JWT_SECRET="$(openssl rand -base64 48)"

# 5. Start a local Postgres (skip if you already have one)
docker compose up -d postgres

# 6. Apply migrations and seed mock data
cd apps/web
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
cd ../..

# 7. Boot the dev server (runs at http://localhost:3000)
pnpm dev:web
```

The admin dashboard is at [http://localhost:3000/admin](http://localhost:3000/admin).
The first time you visit, sign in with a Nostr key and the **setup wizard**
will claim that pubkey as root admin via `POST /api/admin/assign`.

If you want the guided install flow instead, the public bootstrap entrypoint is
the repo-root `install.sh`, which is designed for a hosted `curl | bash` flow:

```bash
curl -fsSL https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/install.sh | bash
```

Or, from inside this repo, use the local wrapper that installs the CLI package
from `apps/cli` and then delegates into that same bootstrap flow:

```bash
bash ./scripts/install-lawallet-cli.sh
```

The standalone installer writes the `lawallet` command into `~/.lawallet/bin`,
downloads a compatible Node.js runtime if necessary, and then runs
`lawallet install`.

Once an instance is installed, you can manage it from `apps/web` with:

```bash
pnpm service status
pnpm service start
pnpm service stop
pnpm service restart
```

To smoke-test the bootstrap flow inside a disposable Docker-in-Docker runner:

```bash
bash ./scripts/test-install-cli-docker.sh
```

That runner executes the same root `install.sh` bootstrap, clones the repo into
a fresh directory, starts the bundled `web + docs + openapi + postgres` Docker
Compose stack, and verifies each health endpoint before exiting.

---

## Environment Variables

All env vars are validated at startup by Zod. Invalid values crash the process
with a readable error. Source of truth: [`apps/web/.env.example`](./apps/web/.env.example).

### Required

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Prisma connection string. Use `postgresql://lawallet:lawallet_password@localhost:5432/lawallet` if you ran `docker compose up -d postgres` |
| `JWT_SECRET` | 32+ char random secret. Required for any authenticated route. Generate with `openssl rand -base64 48` |

### Frequently Used Optional

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |
| `LOG_PRETTY` | `true` for human-readable logs in dev |
| `MAINTENANCE_MODE` | `true` returns 503 for non-admin requests |
| `ALBY_API_URL` / `ALBY_BEARER_TOKEN` / `AUTO_GENERATE_ALBY_SUBACCOUNTS` | Enable courtesy NWC subaccount provisioning |
| `NEXT_PUBLIC_LAWALLET_LANDING_URL` | Where `/` redirects (defaults to `https://lawallet.io`) |

See [`apps/web/.env.example`](./apps/web/.env.example) for the full list.

---

## Database & Migrations

All Prisma commands run from `apps/web/`.

```bash
cd apps/web

# Generate the Prisma client (also runs on `pnpm install`)
pnpm exec prisma generate

# Apply pending migrations to your local DB
pnpm exec prisma migrate deploy

# Create a new migration after editing prisma/schema.prisma
pnpm exec prisma migrate dev --name <descriptive-name>

# Seed mock data
pnpm exec prisma db seed

# Open the visual DB browser
pnpm exec prisma studio
# or, from the repo root:
pnpm studio

# Wipe and reset the local DB (destructive)
pnpm --filter @lawallet-nwc/web reset
```

**Schema location:** [`apps/web/prisma/schema.prisma`](./apps/web/prisma/schema.prisma).
Generated client is emitted to `apps/web/lib/generated/prisma` — never edit
those files by hand.

### Multi-worktree local databases

There are two supported models for running multiple git worktrees in parallel:

1. **Fully isolated stack (recommended)** — run `pnpm start:dev-server` (or
   `pnpm dev:setup`) inside each worktree. Each checkout gets its own Postgres
   container, port, volume, env files, and seeded database, all derived from a
   hash of the worktree path. Nothing to coordinate; nothing collides.
2. **Shared Postgres, one database per worktree (lighter)** — one Postgres
   server with a deterministic database per worktree via
   `scripts/worktree-db.sh`, described below. Uses less memory than one
   container per worktree, but you manage ports and env exports yourself.

If you want multiple git worktrees open at the same time, the simplest setup is
one shared Postgres server with one database per worktree.

Do **not** try to run this repo as "Postgres stored in SQLite" — Prisma is
configured with `provider = "postgresql"` in
[`apps/web/prisma/schema.prisma`](./apps/web/prisma/schema.prisma), so local
SQLite is a different database engine and not a drop-in substitute.

Instead:

```bash
# Start the shared local Postgres once
docker compose up -d postgres

# In each worktree, create or reuse a unique database and export DATABASE_URL
eval "$(./scripts/worktree-db.sh env)"

# Then apply schema changes inside that worktree
cd apps/web
pnpm exec prisma migrate deploy
```

The helper derives a deterministic database name from the current branch +
worktree path, so each checkout gets its own isolated DB on the same
`localhost:5432` server.

Useful commands:

```bash
./scripts/worktree-db.sh name    # print this worktree's DB name
./scripts/worktree-db.sh url     # print the matching DATABASE_URL
./scripts/worktree-db.sh reset   # drop + recreate only this worktree's DB
./scripts/worktree-db.sh drop    # remove only this worktree's DB
```

If you also run multiple Next.js dev servers at once, give each worktree its
own `PORT` in the shell or in `apps/web/.env` to avoid app port collisions.

When changing the schema:

1. Edit `schema.prisma`.
2. Run `pnpm exec prisma migrate dev --name <name>` to create + apply the migration.
3. Commit both `schema.prisma` and the generated SQL under `prisma/migrations/`.

---

## Common Commands

### Workspace-level (from repo root)

| Command | What it does |
|---------|-------------|
| `pnpm install` | Install all workspace deps |
| `pnpm dev` | Run dev servers for every app |
| `pnpm dev:web` | Run only the web app on `:3000` |
| `pnpm dev:docs` | Run the docs app |
| `pnpm build` | Build everything via Turbo |
| `pnpm lint` | Lint every package |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run every package's test suite |
| `pnpm test:coverage` | Run all tests with coverage |
| `pnpm format` | Prettier across the whole repo |
| `pnpm clean` | Clean Turbo + build outputs |
| `pnpm studio` | Open Prisma Studio for `apps/web` |

### Filtered to a single workspace

```bash
# Web app only
pnpm --filter @lawallet-nwc/web dev
pnpm --filter @lawallet-nwc/web build
pnpm --filter @lawallet-nwc/web lint
pnpm --filter @lawallet-nwc/web typecheck
pnpm --filter @lawallet-nwc/web test
pnpm --filter @lawallet-nwc/web test:watch
pnpm --filter @lawallet-nwc/web test:ui          # Vitest UI
pnpm --filter @lawallet-nwc/web test:coverage
pnpm --filter @lawallet-nwc/web test -- tests/unit/lib/jwt.test.ts   # single file
```

### Build caching (Turborepo)

Every `build` / `lint` / `typecheck` / `test` run is cached by Turborepo under
`.turbo/` — unchanged tasks replay from cache in milliseconds (`FULL TURBO`).

**Remote cache (optional, recommended for the core team):** CI and local
machines can share one cache via Vercel Remote Cache. CI picks it up from the
`TURBO_TOKEN` / `TURBO_TEAM` / `TURBO_REMOTE_CACHE_SIGNATURE_KEY` repository
secrets; locally, opt in with:

```bash
npx turbo login    # authenticate against Vercel
npx turbo link     # link this repo to the team's remote cache
```

Forks and contributors without these secrets are unaffected — Turbo silently
falls back to the local cache. Artifact signing is enabled
(`remoteCache.signature` in [`turbo.json`](./turbo.json)), so set
`TURBO_REMOTE_CACHE_SIGNATURE_KEY` in your shell if you link to the shared
cache.

The local cache grows over time (it can reach a few GB). It is always safe to
delete:

```bash
rm -rf .turbo/cache
```

---

## Running Tests

The backend uses [Vitest 3.2](https://vitest.dev/) + [MSW](https://mswjs.io/) +
`happy-dom`. Config: [`apps/web/vitest.config.ts`](./apps/web/vitest.config.ts).

```bash
# All tests
pnpm --filter @lawallet-nwc/web test

# Watch mode
pnpm --filter @lawallet-nwc/web test:watch

# Single file
pnpm --filter @lawallet-nwc/web test -- tests/unit/lib/jwt.test.ts

# Filter by test name
pnpm --filter @lawallet-nwc/web test -- -t "validates NIP-98"

# With coverage report (writes to apps/web/coverage/)
pnpm --filter @lawallet-nwc/web test:coverage
```

### Test layout

- **Unit tests** — `apps/web/tests/unit/lib/` (one file per module under `lib/`).
- **Integration tests** — `apps/web/tests/integration/api/` (one file per route handler).
- **Helpers** — `apps/web/tests/helpers/` (auth, fixtures, route helpers, MSW setup).
- **Setup** — `apps/web/tests/setup.ts` boots the MSW server.

### Coverage thresholds

Enforced by Vitest — CI fails below these:

| Metric | Threshold |
|--------|----------:|
| Statements | 60% |
| Branches | 75% |
| Functions | 70% |
| Lines | 60% |

### What we expect from PRs that touch backend code

- New API routes get an integration test under `tests/integration/api/`.
- New `lib/` modules get a unit test under `tests/unit/lib/`.
- Bug fixes ship with a regression test where it's reasonable to write one.
- Don't lower thresholds without a reason in the PR description.

Read [docs/TESTING.md](./docs/TESTING.md) for the broader testing strategy
and the patterns we use for mocking config, Prisma, the logger, and the
Next.js App Router params.

---

## Code Style

- **Prettier** — [`prettier.config.js`](./prettier.config.js). No semicolons,
  single quotes, no trailing commas, `arrow-parens: avoid`. Run `pnpm format`
  before committing if your editor doesn't on save.
- **ESLint** — `eslint-config-next` with `core-web-vitals`. Run
  `pnpm --filter @lawallet-nwc/web lint` (or `lint:fix`) for the web app.
- **TypeScript** — strict. `pnpm typecheck` is part of CI; keep it green.
- **No barrel exports for app code** — import from the file that defines the symbol.
- **Path alias** — `@/*` maps to `apps/web/` root (e.g. `@/lib/jwt`).
- **Comments** — write them only when the *why* isn't obvious from the code.
  Don't restate what the code does or reference the current PR / issue.

### Code patterns to follow

- All API routes wrap their handler with `withErrorHandling()` from
  [`apps/web/types/server/error-handler.ts`](./apps/web/types/server/error-handler.ts).
- Throw the typed errors in [`apps/web/types/server/errors.ts`](./apps/web/types/server/errors.ts)
  (`ValidationError`, `AuthenticationError`, etc.) — don't return ad-hoc JSON.
- Validate request bodies / queries / params with Zod via
  [`apps/web/lib/validation/middleware.ts`](./apps/web/lib/validation/middleware.ts).
- Authenticated routes go through `lib/auth/unified-auth.ts` (NIP-98 + JWT)
  or the `withAdminAuth()` wrapper for admin-only handlers.
- Logging uses the Pino instance in [`apps/web/lib/logger.ts`](./apps/web/lib/logger.ts).
  Don't `console.log`.

---

## Pull Request Process

1. **Find or open an issue.** For non-trivial work, agree on the approach in
   the issue before opening a PR.
2. **Branch from `main`.** Use a short, descriptive name with a type prefix:
   `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `test/<slug>`.
3. **Make focused commits.** Conventional Commit prefixes are used in the
   project history (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
   `test:`). Match that style — `git log --oneline` is a good reference.
4. **Run the full local check before pushing:**
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```
5. **Open the PR against `main`.** In the description:
   - Link the issue with `Closes #<number>` (or `Refs #<number>` if it's a
     partial change).
   - Summarize what changed and why.
   - Note anything reviewers should look at carefully (auth, schema, public APIs).
6. **CI must be green.** The [CI workflow](./.github/workflows/ci.yml) runs
   `lint`, `typecheck`, `test` (with coverage), and `build`. The `test` and
   `build` jobs gate the PR.
7. **Request review.** Address feedback in additional commits — we squash on
   merge, so don't worry about a tidy commit history.

### What gets a PR rejected fast

- No tests for new backend behaviour.
- Lowered coverage thresholds without justification.
- New env vars without an entry in `apps/web/.env.example`.
- Schema changes without a migration committed.
- `console.log` / dead code / commented-out blocks left behind.
- New API routes without an OpenAPI operation in
  `packages/openapi/src/paths/` — the `pnpm docs:check` CI gate fails
  (regenerate the snapshot with `pnpm docs:sync`).
- Growing `scripts/docs-sync.allowlist.json` instead of documenting the
  route — the allowlist is a ratchet for pre-existing gaps only.

---

## Debugging Tips

> Full runbook: [docs/DEBUGGING.md](./docs/DEBUGGING.md) — request tracing by
> `x-request-id`, `scripts/logs.mjs` filters, slow-query logging
> (`SLOW_QUERY_THRESHOLD_MS`), timing spans, and the auth-failure decode table.

### Server logs

Pino is configured in [`apps/web/lib/logger.ts`](./apps/web/lib/logger.ts).

```bash
# Verbose, human-readable logs in dev
LOG_LEVEL=debug LOG_PRETTY=true pnpm dev:web
```

Every request gets a `reqId` propagated via `AsyncLocalStorage` — grep your
logs by `reqId` to follow a single request end-to-end.

### Inspecting the database

```bash
pnpm studio                 # Prisma Studio, opens in browser
psql "$DATABASE_URL"        # Direct SQL access
```

### Reproducing CI locally

CI runs against `pnpm install --frozen-lockfile` — if installs work locally
but fail in CI, refresh your lockfile:

```bash
pnpm install --frozen-lockfile
```

The build job in CI sets `DATABASE_URL` and `JWT_SECRET` to dummy values just
so Next.js can compile. If your local build fails Zod env validation, make
sure `apps/web/.env` has at least `DATABASE_URL` and `JWT_SECRET`.

### Auth failures

- `401 Authentication required` — header is missing or malformed. Use
  `Authorization: Nostr <base64-event>` (NIP-98) or `Authorization: Bearer <jwt>`.
- `401 Invalid NIP-98 event` — usually a clock skew (events have a ±60s
  window) or the `u` tag doesn't match the request URL.
- `401 JWT expired` — exchange a fresh NIP-98 event at `POST /api/jwt`. The
  client auto-refreshes 5 minutes before expiry; if you're calling the API
  directly, refresh manually.

### Test isolation issues

- Use `resetPrismaMock()` in `beforeEach` — `vi.clearAllMocks()` only clears
  call history, not return values.
- For config/env-sensitive tests, use `vi.resetModules()` + dynamic
  `import()` to bust the module cache.
- The logger calls `getConfig()` at import time — `vi.mock('@/lib/config')`
  must run *before* importing the module under test.

---

## Where to Get Help

- **Architecture & data flow** — [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Testing strategy** — [docs/TESTING.md](./docs/TESTING.md)
- **JWT / NIP-98 details** — [docs/JWT_USAGE.md](./docs/JWT_USAGE.md)
- **Roadmap & open work** — [docs/ROADMAP.md](./docs/ROADMAP.md)
- **Issues & discussions** — [github.com/lawalletio/lawallet-nwc/issues](https://github.com/lawalletio/lawallet-nwc/issues)

By contributing you agree your contributions are licensed under the MIT
license referenced in [`README.md`](./README.md).
