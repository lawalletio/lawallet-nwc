# apps/web — Next.js app (frontend + REST API + LUD-16)

The `@/*` path alias maps to **this directory** (`apps/web/`), not `src/`.
Top-level dirs: `app/` (App Router), `lib/`, `components/`, `types/`,
`tests/`, `prisma/`, `mocks/` (fixed-ID mock data), `e2e/` (Playwright).

## Auth (dual method)

- **NIP-98**: `Authorization: Nostr <base64-event>` — validated in `lib/nip98.ts`
- **JWT**: `Authorization: Bearer <jwt>` — minted at `POST /api/jwt`
  (`lib/jwt.ts`, issuer `lawallet-nwc`, audience `lawallet-users`), verified in
  `lib/jwt-auth.ts`
- `lib/auth/unified-auth.ts` detects the method from the header and resolves
  the role (`lib/auth/resolve-role.ts`: DB + Settings root fallback)
- **RBAC**: roles USER < VIEWER < OPERATOR < ADMIN with granular permissions in
  `lib/auth/permissions.ts`; `lib/admin-auth.ts` provides `withAdminAuth()`
- Device tokens for QR-paired devices: `lib/auth/device-token.ts`

## API routes (`app/api/`)

Resources: activation-tokens, activity, admin, auth, card-designs, cards, dev,
events (SSE), health, invoices, jwt, lightning-addresses, lud16 (public LUD-16
+ LUD-12/21), openapi.json, remote-connections, remote-wallets, settings,
setup, users, wallet.

Every handler is wrapped in `withErrorHandling()` from
`types/server/error-handler.ts` and validates input via
`validateBody`/`validateQuery`/`validateParams` from
`lib/validation/middleware.ts` (Zod schemas come from
`@lawallet-nwc/shared` via the `lib/validation/schemas.ts` shim).

Errors all extend `ApiError` (`types/server/errors.ts`): Validation(400),
Authentication(401), Authorization(403), NotFound(404), Conflict(409),
PayloadTooLarge(413), TooManyRequests(429), ServiceUnavailable(503).

Other middleware: `lib/middleware/rate-limit.ts` (in-memory),
`lib/middleware/request-limits.ts` (body size), `lib/middleware/maintenance.ts`
(global toggle, admins bypass).

## Extensibility pattern (copy this, don't invent new ones)

`lib/wallet/drivers/` is THE pluggable-integration pattern: a module-level
registry Map (`registry.ts`), self-registration at import time (`index.ts`),
and a per-driver Zod `configSchema` validating a JSON config column
(`types.ts`). Adding a wallet type = new module + `registerDriver()` call,
zero call-site changes.

## Database

PostgreSQL via Prisma; schema `prisma/schema.prisma`; client generated into
`lib/generated/prisma` (never edit). Seed: `pnpm seed` (ts-node
`prisma/seed.ts`, also wired as `prisma db seed` via `prisma.config.ts`).
Migrations run against the per-checkout DB from `.env.local`
(see `scripts/dev-worktree.mjs`).

## Frontend

- shadcn/ui + Radix + Tailwind 3.4; forms via React Hook Form + Zod
- Provider stack in `app/providers.tsx`: ThemeProvider → AuthProvider →
  NostrProfileProvider → Toaster
- Auth context: `components/admin/auth-context.tsx` (JWT in memory +
  localStorage, auto-refresh, Nostr signer integration)
- Client hooks in `lib/client/hooks/` (`use-api`, `use-cards`, `use-settings`,
  `use-sse`, …); SSE events stream from `app/api/events/`
- Real-time: `lib/events/event-bus.ts` is an in-process SSE broadcast bus —
  it pushes to connected EventSource clients, it is NOT a server-side handler
  dispatcher. Event names + permission gating: `lib/events/event-types.ts` +
  `EVENT_PERMISSION_MAP` (a total Record — adding an event type without a map
  entry is a compile error).

## Testing (Vitest 3.2 + MSW + happy-dom)

- Unit `tests/unit/`, integration `tests/integration/api/`, component tests
  colocated under `tests/unit/components/`
- Helpers: `tests/helpers/` (auth-helpers, api-helpers, fixtures, prisma-mock,
  route-helpers); MSW server: `tests/mocks/server.ts`
- Mock config with `vi.mock('@/lib/config')`, DB with `vi.mock('@/lib/prisma')`
- prisma-mock uses `createModelMock()` per model; call `resetPrismaMock()` in
  beforeEach (`mockReset` + re-applied `$transaction`)
- **Logger gotcha**: `lib/logger.ts` calls `getConfig()` at module load — mock
  config BEFORE importing anything that imports the logger
- App Router params: `createParamsPromise()` from route-helpers
- Coverage gates: statements 60 / branches 75 / functions 70 / lines 60
