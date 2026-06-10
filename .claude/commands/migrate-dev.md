---
description: Create and apply a Prisma migration against this checkout's isolated DB — /migrate-dev <migration_name>
---

Create a Prisma migration named: $ARGUMENTS

1. Make sure this checkout's DB is up: `pnpm dev:setup` (idempotent, never
   wipes data) — it also writes `apps/web/.env.local` with the right
   DATABASE_URL.
2. From `apps/web/`:
   `pnpm exec prisma migrate dev --name $ARGUMENTS`
3. Run `pnpm --filter @lawallet-nwc/web run db:generate` and
   `pnpm --filter @lawallet-nwc/web typecheck`.
4. If seeded models changed, update `apps/web/prisma/seed.ts` accordingly.
5. Remind: commit BOTH `schema.prisma` and the new `prisma/migrations/`
   directory together.

For schema-design questions (enums vs JSON config columns, fork merge
safety), consult the `prisma-migrator` agent guidance first.
