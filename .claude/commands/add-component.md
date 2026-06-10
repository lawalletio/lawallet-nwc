---
description: Build a UI component via the ui-component-builder agent — /add-component <name + behavior>
---

Delegate to the `ui-component-builder` agent: build $ARGUMENTS

Hand it this brief plus your current task context. Requirements to pass
along: compose shadcn primitives from `components/ui/`, data via
`lib/client/hooks/`, forms with RHF+Zod, permission gating via
`<PermissionGuard>`, theme via CSS variables (no hard-coded colors), and a
component test under `tests/unit/components/` when there's interaction
logic. After it finishes, verify in the running dev server with the preview
tools and show a screenshot.
