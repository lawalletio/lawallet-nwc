# @lawallet-nwc/nostr-trigger

Persistent Bun + TypeScript runtime that keeps WebSocket subscriptions to Nostr relays open, reacts to NIP-47 NWC payment notifications in real time, and triggers configured actions (webhooks, NIP-57 zap receipts).

See [`docs/services/NOSTR-TRIGGER.md`](../../docs/services/NOSTR-TRIGGER.md) for the full architecture, operational runbook, and API reference.

## Quick start

```bash
# 1. Prerequisites: Postgres (shared with apps/web) and Redis running locally
docker compose up -d postgres redis

# 2. Apply Prisma migrations (first time only)
pnpm --filter @lawallet-nwc/prisma run db:migrate:deploy

# 3. Copy and fill environment
cp apps/nostr-trigger/.env.example apps/nostr-trigger/.env
# edit NT_MASTER_KEY, NT_ADMIN_SECRET, NT_SERVICE_NSEC, NT_LNURL_NSEC

# 4. Run
pnpm --filter @lawallet-nwc/nostr-trigger dev
```

Service listens on `http://localhost:3010`. All `/api/v1/*` endpoints require `Authorization: Bearer $NT_ADMIN_SECRET`.

## Commands

```bash
pnpm --filter @lawallet-nwc/nostr-trigger dev        # hot-reload with bun
pnpm --filter @lawallet-nwc/nostr-trigger start      # run once with bun
pnpm --filter @lawallet-nwc/nostr-trigger build      # produce dist/index.js
pnpm --filter @lawallet-nwc/nostr-trigger typecheck
pnpm --filter @lawallet-nwc/nostr-trigger test
```
