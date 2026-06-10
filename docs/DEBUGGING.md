# Debugging Runbook

Practical recipes for diagnosing runtime issues in `apps/web`.

## Verbose logging

```bash
LOG_LEVEL=debug LOG_PRETTY=true pnpm dev:web
```

All server logs are structured Pino JSON (`apps/web/lib/logger.ts`). At
`debug`, every Prisma query and timing span is visible; at the default
`info`, only request start/end and warnings appear.

## Follow one request end-to-end

Every request gets a `reqId` (AsyncLocalStorage correlation), echoed back on
the **`x-request-id` response header**. Grab it from the failing response,
then filter the server logs:

```bash
pnpm dev:web 2>&1 | node scripts/logs.mjs --reqId=<id>
node scripts/logs.mjs --reqId=<id> < server.log        # from a saved log
```

Other useful filters:

```bash
node scripts/logs.mjs --module=prisma --minMs=100      # slow queries only
node scripts/logs.mjs --span=nwc.pay_invoice           # NWC payment spans
node scripts/logs.mjs --level=warn                     # warnings and up
```

## Timing spans

Multi-hop flows are instrumented with `withSpan()`
(`apps/web/lib/observability/timing.ts`) — currently the NWC driver ops
(`nwc.get_balance`, `nwc.pay_invoice`, `nwc.make_invoice`). Spans log
`{ reqId, span, durationMs, ok }` at debug (warn on failure), so one `reqId`
shows where the time went. Wrap new hot paths the same way.

## Slow queries

Prisma queries slower than `SLOW_QUERY_THRESHOLD_MS` (default 100) log at
**warn** with the SQL and duration — visible even at the default log level.
Set `0` to disable, or lower it while hunting a regression.

## Auth failure decode table

| Symptom | Cause / fix |
|---------|-------------|
| 401 "Invalid or expired JWT" | Issuer/audience/secret mismatch. Tokens must be issuer `lawallet-nwc`, audience `lawallet-users`, signed with the running server's `JWT_SECRET`. Note: each worktree has its **own** secret in `apps/web/.env.local`. |
| 401 on NIP-98 | Check event `created_at` clock skew, exact URL match (scheme/host/port), uppercase method, payload hash. |
| 403 `AUTHORIZATION_ERROR` | Authenticated but missing the permission — check `lib/auth/permissions.ts` mapping and the user's role in the DB (or the role claim in the JWT). |
| 503 from `/api/health` | The server is up but can't reach the database — see below. |

## Database issues

- **"Can't reach database" / health 503** — wrong `DATABASE_URL` for this
  checkout. Each worktree runs its own Postgres container
  (`lawallet-nwc-<hash>-postgres-1` in `docker ps`); `pnpm dev:env` prints
  this checkout's connection details.
- **Migration drift / broken local schema** — `pnpm dev:db:reset`
  (destructive, current checkout's DB only).
- **Env validation crash at boot** — Zod errors from
  `apps/web/lib/config/env.ts` name the exact variable; fix it in
  `apps/web/.env.local` (see `.env.example` for the full list).

## Ports

The dev server port is **per worktree** (printed by `pnpm start:dev-server`);
`:3000` is only the main checkout's default. E2E runs use `:3100` and a
dedicated `*_e2e` database — they never collide with dev.

## Minimal repro checklist

1. Reproduce with `LOG_LEVEL=debug LOG_PRETTY=true`.
2. Capture the `x-request-id` and filter with `scripts/logs.mjs`.
3. Identify the failing layer: auth → validation → handler → Prisma → driver.
4. Check the matching integration test in `apps/web/tests/integration/api/`
   — it encodes the intended behavior.
5. A 500 response means an **untyped** error escaped `withErrorHandling` —
   the stack trace in the logs points at the gap.
