---
description: Add a wallet driver or plugin without touching core — /add-integration <what to integrate>
---

Delegate to the `integration-author` agent: integrate $ARGUMENTS

It follows the repo's extension seams: wallet protocols become drivers in
`apps/web/lib/wallet/drivers/` (new module + one registration line + enum
migration); larger integrations become plugins under `apps/web/plugins/`
once the plugin runtime exists. Fork rule it must respect: only the new
module's directory plus a single registration line may change — no edits to
core `app/`, `lib/` (outside the new module), or `components/`.

When it's done, run `/check` and summarize exactly which files were touched
to prove the no-core-edits rule held.
