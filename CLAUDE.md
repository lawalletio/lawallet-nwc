# CLAUDE.md

Guidance for Claude Code in this repository. App- and package-level detail
lives in scoped CLAUDE.md files that load automatically when you work there:
`apps/web/`, `apps/docs/`, `apps/listener/`, `apps/cli/`, `packages/shared/`.

## Project Overview

LaWallet NWC is an open-source Lightning Address platform with Nostr Wallet
Connect. Communities give members lightning addresses, integrated wallets, and
Nostr identity on custom domains, on a progressive self-custody model.

**Status**: Pre-alpha (OpenSats grant, Dec 2025–June 2026)

## Monorepo Structure

pnpm workspaces + Turborepo. Node v22.14.0 (`.nvmrc`), pnpm 10.11.0.

```
apps/
  web/          Next.js 16 — frontend, REST API, LUD-16 resolution (main app)
  docs/         Fumadocs — documentation site
  listener/     NWC Payment Listener (stub; see docs/services/NWC-LISTENER.md)
  cli/          Installer CLI behind the curl|bash bootstrap (install.sh)
packages/
  shared/       Zod schemas + shared types (source of truth: src/schemas.ts)
  openapi/      Zod → OpenAPI 3.1 document generation
  sdk/          TypeScript SDK client (stub)
```

## Branch & PR Workflow

This repo has **no GitHub issues** — do not use `gh issue develop`. Instead:

1. `git checkout -b feat/<slug>` (or `fix/`, `chore/`, `docs/`) from latest `main`.
2. Open a **draft PR** early: `gh pr create --draft --base main ...`.
3. Push commits → mark ready → merge. Never push to `main` directly.
4. Don't delete branches with unmerged work.

## Commands

```bash
pnpm start:dev-server   # one-command bootstrap + dev server (isolated DB/ports)
pnpm dev:setup          # same bootstrap without launching the server
pnpm dev:db:reset       # explicit destructive DB reset + reseed
pnpm dev:web            # dev server only (assumes env + DB ready)
pnpm build | lint | typecheck | test | test:coverage   # turbo-cached
pnpm --filter @lawallet-nwc/web test -- tests/unit/lib/jwt.test.ts  # single file
pnpm studio             # Prisma Studio
```

`/check` runs the full pre-PR gate (typecheck + lint + tests).

## Worktree Dev Loop

Each git worktree provisions itself: the SessionStart hook materializes
isolated env files (own Postgres container, ports, DB, JWT secret) via
`scripts/dev-worktree.mjs`. To work on a feature in parallel: create/enter a
worktree → `pnpm start:dev-server` → the printed URL is that worktree's own
port. Use the preview tools against that URL for visual iteration. Re-runs
never wipe data (`pnpm dev:db:reset` does, on purpose).

## Code Style

Prettier: no semicolons, single quotes, no trailing commas, arrow parens
avoid. ESLint: Next.js core-web-vitals. An Edit/Write hook auto-formats
changed TS/TSX files — don't hand-format.

## Skill & Subagent Map

| Task | Use |
|------|-----|
| REST API route handlers | `api-route-author` agent; skills: next-best-practices, nodejs-backend-patterns |
| Tests (Vitest/MSW) | `test-writer` agent; skill: vitest |
| Schema / migrations / seed | `prisma-migrator` agent; skills: prisma-client-api, prisma-cli |
| UI components | `ui-component-builder` agent; skills: shadcn, tailwind-v4-shadcn, frontend-design |
| Auth / RBAC / validation audit | `security-auditor` agent (read-only) |
| Wallet drivers & integrations | `integration-author` agent (the no-core-edits path) |
| Docs (Fumadocs, OpenAPI) | `docs-writer` agent; seo/accessibility skills apply to apps/docs + landing only |
| Log/trace triage | `debug-helper` agent |
