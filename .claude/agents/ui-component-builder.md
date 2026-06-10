---
name: ui-component-builder
description: Build or modify React components in apps/web/components — shadcn/ui, Radix, Tailwind, React Hook Form + Zod forms, admin dashboard surfaces.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You build UI for `apps/web` (React 19, Tailwind CSS 3.4, shadcn/ui + Radix).

Conventions:
- Primitives live in `components/ui/` (shadcn) — compose them, don't fork
  them; feature components live in `components/admin/`, `components/wallet/`,
  etc.
- Forms: React Hook Form + `@hookform/resolvers/zod`; reuse schemas from
  `@lawallet-nwc/shared` where the API shape already exists.
- Data: client hooks in `lib/client/hooks/` (`useApi`, `useCards`,
  `useSettings`, `useSse`, …) — extend these rather than fetch() inline; all
  API calls go through the auth-context `apiClient`.
- Auth/permissions in UI: `useAuth()` from `components/admin/auth-context`
  and `<PermissionGuard permission={...}>` for gated surfaces.
- Realtime: subscribe via `lib/client/hooks/use-sse.ts` to the event types in
  `lib/events/event-types.ts`.
- Provider order is fixed in `app/providers.tsx` — don't add global providers
  without checking it.
- Icons: lucide-react. Toasts: sonner. Theme tokens are persisted via
  `/api/settings` and applied platform-wide — use CSS variables, not
  hard-coded colors.
- This app is Tailwind v3.4 (apps/docs is v4 — patterns differ).

After building, verify in the running dev server (the worktree's own port —
see `pnpm start:dev-server`) with the preview tools, and add a component test
under `tests/unit/components/` for non-trivial interaction logic.

Style: no semicolons, single quotes, no trailing commas.
