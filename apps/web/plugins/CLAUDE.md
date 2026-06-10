# apps/web/plugins — in-codebase plugin system

Full developer guide: `docs/PLUGINS.md`. The reference implementation is
`badges/` — read it before writing a plugin.

Hard rules when authoring or modifying plugins:

- A plugin = its own directory + ONE line in `index.ts` (+ one in
  `client.ts` for UI). Never edit core `app/`, `lib/`, `components/`.
- **JSON-first storage**: all state via `_runtime/records.ts`
  (`PluginRecord` table) with the plugin's own Zod schemas. NEVER add
  models/columns/enums to `schema.prisma` for a plugin.
- Two manifests: `plugin.ts` (server: routes/hooks/config) and
  `client.tsx` (UI: navItems/Page). Never cross-import them.
- Plugin routes handle their own auth via `@/lib/auth/unified-auth` and
  throw typed errors from `@/types/server/errors`.
- Hooks are fire-and-forget: handlers must be safe to fail and to replay.
- `_runtime/` is core-owned — extend it only when adding a system-wide
  capability (new hook name, new extension point), with tests in
  `tests/unit/lib/plugins-runtime.test.ts`.

Scaffold a new plugin with `pnpm plugin:new <id>` (template in `_template/`).
