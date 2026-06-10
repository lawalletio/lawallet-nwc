---
description: Pre-PR gate — typecheck + lint + full test suite (turbo-cached)
---

Run the full pre-PR verification gate and report a pass/fail summary per step:

1. `pnpm turbo run typecheck`
2. `pnpm turbo run lint`
3. `pnpm turbo run test`

All three are turbo-cached — unchanged packages replay instantly. If anything
fails, show only the failing output, fix it if the fix is obvious and within
the current task's scope, and re-run the failed step. Do not mark the gate
passed while any step is red.
