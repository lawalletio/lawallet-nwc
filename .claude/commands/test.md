---
description: Run tests — `/test <file|pattern>` for one file, `/test` for everything; use `/test write <what>` to author tests
---

Arguments: $ARGUMENTS

- No arguments → `pnpm turbo run test` (all packages, cached).
- A path or pattern → run just that:
  `pnpm --filter @lawallet-nwc/web exec vitest run $ARGUMENTS`
  (paths are relative to `apps/web/`, e.g. `tests/unit/lib/jwt.test.ts`).
- Starts with `write` → delegate to the `test-writer` agent with the rest of
  the arguments as the brief; it knows the helpers, MSW setup, prisma-mock
  reset rules, and the logger/config mock-ordering gotcha.
- Coverage → `pnpm --filter @lawallet-nwc/web test:coverage`
  (gates: statements 60 / branches 75 / functions 70 / lines 60).

Report the summary line (files/tests passed) — not the full output — unless
something fails, in which case show the failing test output verbatim.
