# Forking & Extending LaWallet NWC

The 10-minute golden path from fork to a running, extended instance.

## 1. Fork and run

```bash
git clone https://github.com/<you>/lawallet-nwc.git
cd lawallet-nwc
pnpm start:dev-server
```

One command: dependencies, env files (with a generated `JWT_SECRET`), an
isolated Postgres container, migrations, deterministic seed, dev server at
the printed URL. Re-runs never wipe data. Details:
[CONTRIBUTING.md → Local Setup](../CONTRIBUTING.md#local-setup).

Work on multiple branches in parallel with git worktrees — each gets its own
database, ports, and env automatically
([CONTRIBUTING.md → Multi-worktree](../CONTRIBUTING.md#multi-worktree-local-databases)).

## 2. Verify your environment

```bash
pnpm typecheck && pnpm lint && pnpm test    # turbo-cached quality gate
pnpm e2e                                    # real-stack E2E (dedicated *_e2e DB)
pnpm docs:check                             # API ↔ OpenAPI ↔ docs drift guard
```

## 3. Extend without touching core

The supported extension seam today is the **wallet driver registry**
(`apps/web/lib/wallet/drivers/`) — add support for a new wallet protocol by
writing one module plus one registration line. Step-by-step:
[add-a-driver guide](https://docs.lawallet.io/docs/guides/add-a-driver)
(source: `apps/docs/content/docs/guides/add-a-driver.mdx`).

The merge-safety rule that keeps your fork clean: **your changes live in
your own module's directory plus at most one registration line.** Avoid
editing core `app/`, `lib/` (outside your module), or `components/` — and
avoid adding Prisma enum values where a Zod-validated JSON config column
works (enums are the #1 merge-conflict point when pulling upstream).

> An in-codebase plugin system (sidebar pages, settings panels, API routes,
> lifecycle hooks — all without core edits) is in progress; the
> `docs/plugins/*.md` documents describe the longer-term external
> Nostr-service model.

## 4. Stay in sync with upstream

```bash
git remote add upstream https://github.com/lawalletio/lawallet-nwc.git
git fetch upstream && git merge upstream/main
pnpm dev:setup            # re-migrate after upstream schema changes
pnpm test && pnpm e2e     # confirm nothing broke
```

If you followed the merge-safety rule, upstream merges won't conflict with
your extensions.

## 5. Contribute back

PR mechanics, code style, and the review checklist live in
[CONTRIBUTING.md](../CONTRIBUTING.md). New API routes must ship with an
OpenAPI operation (`pnpm docs:check` enforces this) and new env vars must be
documented in `apps/web/.env.example`.
