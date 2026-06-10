---
description: Review a PR against LaWallet conventions — /review-pr <number> (or empty for current branch)
---

Review: $ARGUMENTS (if empty, review the current branch's diff against main).

Use the built-in /review flow, plus these repo-specific checks:

- Every new/changed `app/api/**/route.ts` verb: wrapped in
  `withErrorHandling`, validates input via the shared Zod schemas, gates on a
  permission (not a role string), and has a matching integration test.
- Schema changes: migration committed alongside `schema.prisma`; no new enum
  where a Zod-validated JSON column would do; seed updated.
- New env vars: present in `apps/web/.env.example` AND validated in
  `lib/config/env.ts`.
- Public API changes: `packages/openapi/src/paths/` updated (coverage test in
  `packages/openapi/tests/document.test.ts` still passes).
- Style: no semicolons, single quotes, no trailing commas; no hand-rolled
  status JSON; no `console.log` (use `lib/logger.ts`).
- Tests pass: `pnpm turbo run test`.
