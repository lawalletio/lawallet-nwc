# In-Codebase Plugins

Extend LaWallet NWC — API routes, admin pages, sidebar entries, lifecycle
hooks, persisted state — **without touching core code**. A plugin is one
directory under `apps/web/plugins/` plus one registration line; upstream
merges never conflict with it.

> Looking for the older proposal of *external* Nostr-service plugins?
> That's `docs/plugins/*.md`. This document describes the implemented,
> in-process system.

## Quick start

```bash
pnpm plugin:new my-plugin
```

This scaffolds `apps/web/plugins/my-plugin/` from the template and prints
the two registration lines to add:

- `apps/web/plugins/index.ts` — server manifest (`registerPlugin(...)`)
- `apps/web/plugins/client.ts` — client manifest, if it ships UI
  (`registerPluginClient(...)`)

Enable it at **/admin/plugins** (or `PATCH /api/plugins/my-plugin`
with `{ "enabled": true }`, SETTINGS_WRITE).

## Anatomy

```
apps/web/plugins/
  _runtime/        the plugin system itself (core-owned — don't edit)
  index.ts         server registration (one line per plugin)
  client.ts        client registration (one line per UI plugin)
  badges/          reference plugin — read this first
    plugin.ts      server manifest: id, configSchema, routes, hooks
    client.tsx     client manifest: nav items + Page component
```

A plugin has **two manifests** so server-only code (Prisma, hooks) never
enters the client bundle:

| File | Runs on | Declares |
|------|---------|----------|
| `plugin.ts` | server | `id`, `name`, `version`, `configSchema` (Zod), `defaultEnabled`, `routes`, `hooks`, `migrate` |
| `client.tsx` | client | `id` (must match), `navItems`, `Page` |

## Extension points

### API routes

`/api/plugins/<id>/...` is delegated to your `routes(request, { method,
path })` handler by a single core catch-all. Disabled plugins 404. Use the
same conventions as core routes — typed errors from
`@/types/server/errors`, Zod validation, and **auth is your job** via
`@/lib/auth/unified-auth` (`authenticate`, `authenticateWithPermission`).

### Admin UI

`navItems` adds sidebar entries (with optional per-item `permission` —
RBAC applies automatically). `href: '/admin/plugins/<id>'` is served by the
core page host, which renders your `Page` component — a full admin page
with zero core route files.

### Lifecycle hooks

Subscribe in the server manifest:

```ts
hooks: {
  'invoice:paid': async payload => { /* ... */ }
}
```

Available hooks (see `_runtime/types.ts` for payloads): `invoice:paid`,
`plugin:toggled`. Dispatch is fire-and-forget — **a throwing handler is
logged and never breaks the business operation** that emitted it.

### Storage — the JSON-first rule (important)

ALL plugin state goes through `PluginRecord`
(`_runtime/records.ts`: `putRecord` / `getRecord` / `listRecords` /
`deleteRecord`), validated by your own Zod schemas:

```ts
await putRecord('my-plugin', 'item', key, itemSchema, data)
```

**Never add models, columns, or enum values to `schema.prisma` for a
plugin.** That is the one seam that creates fork merge conflicts (the
wallet-driver `RemoteWalletType` enum is the cautionary example). The
JSON-first rule is what makes plugins zero-migration and merge-clean.

### Config

`configSchema` validates your plugin's config JSON. Give every field a
`.default()` so an absent config parses. (Config persistence UI is on the
roadmap; until then read config records via `getRecord(id, 'config', ...)`.)

### Enable / disable

State is one Settings row (`plugin.<id>.enabled`) — no migration. On
enable, your idempotent `migrate()` runs (set up initial records there).
Disabled plugins contribute nothing: no nav, no pages, 404 routes, skipped
hooks.

## Rules (the fork contract)

1. Your plugin touches ONLY `apps/web/plugins/<id>/` + one line in
   `plugins/index.ts` (+ one in `client.ts`).
2. JSON-first storage — no `schema.prisma` edits, ever.
3. Reuse core conventions: typed errors, Zod validation, unified auth,
   `lib/logger`. No new frameworks.
4. Server/client split — never import `plugin.ts` from `client.tsx` or
   vice versa.
5. Hooks must tolerate replay and failure (fire-and-forget semantics).

## Testing

Unit-test against the runtime with the standard helpers — see
`tests/unit/lib/plugins-runtime.test.ts` for registry/loader/hooks/records
patterns (prisma-mock includes `pluginRecord`).
