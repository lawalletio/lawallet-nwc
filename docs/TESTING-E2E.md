# End-to-End Testing (Playwright)

E2E tests live in `apps/web/e2e/` and exercise the real stack: a real
`next dev` server, real Postgres, real JWT verification — no mocks.

## Running

```bash
pnpm e2e                                  # from the repo root (turbo), or:
pnpm --filter @lawallet-nwc/web e2e       # directly
pnpm --filter @lawallet-nwc/web e2e:ui    # Playwright UI mode
pnpm --filter @lawallet-nwc/web e2e:headed
PW_ALL_BROWSERS=1 pnpm e2e                # adds firefox + webkit
```

Prerequisite: a reachable Postgres (run `pnpm dev:setup` once). The suite
never touches your dev data — see the database section.

## How it works

```
pnpm e2e
 ├─ e2e/provision-db.mjs   derive <db>_e2e from your DATABASE_URL,
 │                         migrate deploy (creates the DB), truncate all
 │                         tables, run the deterministic seed
 └─ playwright test        boots `next dev` on :3100 (E2E_PORT) with
                           DATABASE_URL=<db>_e2e and a fixed JWT secret,
                           waits for /api/health (which pings the DB)
```

- **Dedicated database** — the provision script suffixes the database name
  with `_e2e` and refuses (hard interlock) to run against any database not
  named `*_e2e`. Your dev data is never touched.
- **Dedicated server** — `reuseExistingServer: false`, always port 3100
  (`E2E_PORT` to override): a reused dev server would have the wrong DB and
  JWT secret.
- **Deterministic seed** — the repo seed (`apps/web/prisma/seed.ts`) inserts
  fixed-ID fixtures from `apps/web/mocks/*.ts`: usernames `alice`, `bob`, …
  and stable npub pubkeys, so specs can assert exact values.

## Auth in specs

`e2e/fixtures/auth.ts` mints session JWTs directly (same claims as
`POST /api/jwt`: userId/pubkey/role/permissions; issuer `lawallet-nwc`,
audience `lawallet-users`) signed with the webServer's fixed secret, and
injects them into `localStorage['lawallet-jwt']` before page load — exactly
where the client keeps its session. This skips Nostr event signing while
still exercising the server's real JWT verification.

```ts
import { test, expect } from './fixtures/auth'

test('admin sees users', async ({ adminPage }) => {
  await adminPage.goto('/admin/users')
  await expect(adminPage.getByText(/npub1/i).first()).toBeVisible()
})
```

Fixtures: `adminPage` (seeded ADMIN), `userPage` (seeded USER), or call
`mintSessionToken(pubkey, role)` for API-level requests.

## Visual regression

`expect(page).toHaveScreenshot()` is configured with
`maxDiffPixelRatio: 0.01`. Baselines are committed under
`e2e/**/__screenshots__/`; update with `pnpm e2e:update`. Screenshots are
OS/font-sensitive — only enforce baselines generated on the CI runner image.

## CI

`.github/workflows/e2e.yml` runs chromium against a postgres:15 service and
uploads the HTML report + junit artifacts on every PR. When the suite grows
past a few minutes, shard it with a matrix
(`playwright test --shard=N/4`).

## For the fast inner loop

During development, prefer the preview tools (`preview_start` against your
worktree's dev server) for visual iteration, and promote anything worth
enforcing into a Playwright spec here.
