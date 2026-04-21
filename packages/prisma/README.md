# @lawallet-nwc/prisma

Shared Prisma schema, migrations, and generated client for every service in the monorepo.

- `schema.prisma` — single source of truth for all models
- `migrations/` — database migrations
- `src/generated/` — generated Prisma client (ignored by git, built via `pnpm run build`)
- `src/index.ts` — exports `prisma` singleton and all model types
- `src/seed.ts` — optional dev/test seed script

## Commands

```bash
pnpm --filter @lawallet-nwc/prisma run build           # prisma generate
pnpm --filter @lawallet-nwc/prisma run db:migrate:dev  # create + apply a new migration
pnpm --filter @lawallet-nwc/prisma run db:migrate:deploy  # apply pending migrations (production)
pnpm --filter @lawallet-nwc/prisma run db:seed         # run seed script
pnpm --filter @lawallet-nwc/prisma run db:studio       # visual DB browser
```

## Consuming in another workspace package

```ts
import { prisma, NwcConnection } from '@lawallet-nwc/prisma'
```

## Why a shared package

Both `@lawallet-nwc/web` and `@lawallet-nwc/nostr-trigger` read/write the same Postgres. Extracting Prisma into its own package avoids duplicated generated clients and keeps the schema in one place — required for the `nostr-trigger` service's `NwcConnection`, `WebhookEndpoint`, `NostrTriggerAdmin`, `AuditEvent`, and `ZapReceiptLedger` models, which reference the existing `User` table.
