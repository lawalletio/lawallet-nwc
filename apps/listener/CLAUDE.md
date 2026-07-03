# apps/listener — NWC relay bridge (transport-only)

Long-running Node 22 service. Holds one live `NWCClient` (`@getalby/sdk`) per
ACTIVE NWC `RemoteWallet` read from the shared Postgres, forwards NIP-47
notifications to apps/web as HMAC-signed webhooks, and proxies NWC requests
over the open connections (`POST /nwc/request`) so web avoids a relay
handshake per call. Full contract + ops doc: `docs/services/NWC-LISTENER.md`.

## Invariants

- **Transport-only.** Never interpret payments — no invoice matching, no
  receipts, no business logic. That all lives in apps/web.
- **`pg` only, no Prisma.** LISTEN/NOTIFY needs a raw client anyway; every
  query in `src/db.ts` / `src/store.ts` is hand-written SQL against the
  quoted `"RemoteWallet"` table or the service-owned `listener` schema.
- **The `listener` schema is owned HERE** — bootstrapped idempotently by
  `src/store.ts` (`CREATE ... IF NOT EXISTS`). Never add it to web's Prisma
  migrations.
- **Cross-service contracts live in `packages/shared/src/listener.ts`**
  (webhook payload, /nwc/request, /status, header names, NOTIFY channel).
  Change shapes there, never inline.
- **apps/web must run without this service.** Anything new on the web side
  has to stay behind the optional `LISTENER_URL`/`LISTENER_AUTH_SECRET` envs.
- **Dedup key is derived**, not a Nostr event id (`sha256(walletId|type|`
  `payment_hash)`) — the SDK's `subscribeNotifications` callback never
  exposes raw events. Don't "fix" this without replacing the subscription
  layer.

## Module map (src/)

- `index.ts` — startup order, notification handler, timers, shutdown
- `env.ts` — Zod env (memoized); loads `.env.local` best-effort
- `logger.ts` — pino root + `patchConsole` (SDK logs via console.*)
- `metrics.ts` — in-memory /status counters
- `db.ts` — pg pool, wallet queries, dedicated LISTEN client w/ reconnect
- `store.ts` — `listener.processed_events` bootstrap, dedup, delivery state
- `nwc/reconcile.ts` — pure `diffWallets` (add/remove/rotate)
- `nwc/pool.ts` — NWCClient lifecycle, backoff, `request()` method map
- `webhook.ts` — HMAC signing, delivery retry, sweep (web-down recovery)
- `http/` — bearer auth + node:http routes (/health, /status, /nwc/request)

## Build & dev

- `pnpm dev:setup` at the repo root writes `apps/listener/.env.local`; then
  `pnpm dev:listener` (tsx watch). Tests: `pnpm --filter
  @lawallet-nwc/listener test` (vitest, node env, everything mocked — no
  relay or DB needed).
- Build is **tsup**, not tsc: `@lawallet-nwc/shared` ships raw TS and Node
  won't type-strip under node_modules, so the shared package is bundled in
  (`noExternal`). `tsc --noEmit` stays the typecheck.
- Local `prettier.config.js` (ESM) mirrors the root config — the CJS root
  file can't be loaded by the prettier CLI from here.
