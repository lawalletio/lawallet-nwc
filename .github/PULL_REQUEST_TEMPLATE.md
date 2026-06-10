## Summary

<!-- What does this PR do, and why? -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally
- [ ] New/changed API routes have an OpenAPI operation in
      `packages/openapi/src/paths/` (`pnpm docs:check` passes; snapshot
      regenerated with `pnpm docs:sync` if the spec changed)
- [ ] New env vars are documented in `apps/web/.env.example` and validated in
      `apps/web/lib/config/env.ts`
- [ ] Schema changes include the migration AND an updated seed if seeded
      models changed
- [ ] New failure modes are covered in `docs/DEBUGGING.md` (if user-facing)
- [ ] E2E (`pnpm e2e`) considered for flows crossing auth + API + DB
