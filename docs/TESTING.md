# Testing Guide

This document is the practical guide to testing in **lawallet-nwc**: how to run the suite, how it is organized, how to write new tests, what to mock, and the coverage bar new code is expected to clear.

> **Audience:** contributors writing or maintaining tests in `apps/web/`. Other apps (`apps/listener/`, `apps/docs/`) are stubs and have no test suite yet.

> **Snapshot:** the suite currently sits at **50 files / 585 tests** and runs in well under five seconds. Keep it that way — fast tests get run, slow tests get skipped.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Testing Stack](#testing-stack)
- [Testing Pyramid](#testing-pyramid)
- [Directory Layout](#directory-layout)
- [Running Tests](#running-tests)
- [Writing Unit Tests](#writing-unit-tests)
- [Writing API Integration Tests](#writing-api-integration-tests)
- [Mocking Strategies](#mocking-strategies)
- [Helpers Reference](#helpers-reference)
- [Coverage Requirements](#coverage-requirements)
- [Best Practices](#best-practices)
- [Common Pitfalls](#common-pitfalls)
- [CI Integration](#ci-integration)

---

## Quick Start

From the repo root:

```bash
pnpm --filter @lawallet-nwc/web test                  # run the whole suite once
pnpm --filter @lawallet-nwc/web test:watch            # rerun on file change
pnpm --filter @lawallet-nwc/web test:coverage         # generate coverage report
pnpm --filter @lawallet-nwc/web test -- tests/unit/lib/jwt.test.ts   # one file
```

All scripts are defined in [apps/web/package.json](../apps/web/package.json). Tests live under [apps/web/tests/](../apps/web/tests/).

---

## Testing Stack

| Tool | Role |
|------|------|
| [Vitest 3.2](https://vitest.dev) | Test runner, assertion library, watch mode, UI, coverage |
| [happy-dom](https://github.com/capricorn86/happy-dom) | Lightweight DOM for hook/component tests |
| [MSW](https://mswjs.io) | HTTP mocking for outbound calls (Alby, third-party) |
| [@faker-js/faker](https://fakerjs.dev) | Random fixture data |
| [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) | DOM matchers (`toBeInTheDocument`, etc.) |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | IndexedDB polyfill for client-side cache modules |

Configuration lives in [apps/web/vitest.config.ts](../apps/web/vitest.config.ts). Key settings:

- `globals: true` — `describe`, `it`, `expect` are global (no per-file imports needed)
- `environment: 'happy-dom'` — DOM is available in every test
- `setupFiles: ['./tests/setup.ts']` — boots MSW + jest-dom matchers + fake IndexedDB
- `@/*` path alias resolves to `apps/web/`

---

## Testing Pyramid

| Layer | Tool | Scope | Target |
|-------|------|-------|--------|
| Unit | Vitest | Hooks, utilities, lib functions | 80% |
| Component | Vitest + RTL + happy-dom | UI components | 70% |
| API | Vitest + MSW + Prisma mock | Route handlers, middleware, auth | 90% |
| Integration | Vitest + Prisma mock | DB-touching flows, auth chains | 70% |
| E2E | Playwright (planned, Month 3+) | Multi-browser flows | Critical paths |
| Overall | v8 coverage | Whole codebase | 60% statements / 75% branches / 70% functions / 60% lines |

The pyramid widens at the bottom — **most coverage should come from fast unit and API tests**. Reserve heavier integration tests for flows that genuinely cross module boundaries (auth chain, payment routing, NWC).

---

## Directory Layout

```
apps/web/tests/
├── setup.ts                       # Vitest setup — MSW, IDB polyfill, jest-dom
├── helpers/
│   ├── api-helpers.ts             # createNextRequest, assertResponse
│   ├── auth-helpers.ts            # mockAdminAuth, mockNip98, JWT payload helpers
│   ├── fixtures.ts                # faker-backed fixtures: User, Card, Design, etc.
│   ├── prisma-mock.ts             # Deep PrismaClient mock + resetPrismaMock
│   └── route-helpers.ts           # createParamsPromise, createDefaultConfig
├── mocks/
│   ├── handlers.ts                # MSW handlers for outbound HTTP
│   └── server.ts                  # MSW server instance
├── unit/
│   ├── lib/                       # Pure utility / lib tests
│   │   ├── client/                # Browser-side modules (cache, NWC parsing, stores)
│   │   ├── auth.test.ts
│   │   ├── jwt.test.ts
│   │   └── ... (~20 files)
│   └── components/                # Component-level tests (currently `wallet/`)
└── integration/
    └── api/                       # Route handler tests (one file per resource)
        ├── cards.test.ts
        ├── jwt.test.ts
        ├── lud16.test.ts
        └── ... (~24 files)
```

**Naming:** mirror the path of the source file. `lib/jwt.ts` → `tests/unit/lib/jwt.test.ts`. `app/api/cards/route.ts` → `tests/integration/api/cards.test.ts`. Co-located patterns are not used.

---

## Running Tests

From `apps/web/`:

```bash
pnpm test                        # full suite, single run
pnpm test:watch                  # interactive watch mode
pnpm test:ui                     # Vitest browser UI
pnpm test:coverage               # generate coverage/ report
pnpm test -- tests/unit/lib/jwt.test.ts     # single file
pnpm test -- -t 'verifies a valid token'    # filter by test name
pnpm test -- tests/integration/api          # whole folder
```

Coverage output lands in `apps/web/coverage/` (HTML at `coverage/index.html`, lcov at `coverage/lcov.info`). The HTML report is the friendliest way to find untested branches.

---

## Writing Unit Tests

Unit tests live under `tests/unit/lib/`. They cover one module, mock everything across the boundary, and aim to be fast and deterministic.

**Skeleton:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createJwtToken, verifyJwtToken } from '@/lib/jwt'

const SECRET = 'test-secret-that-is-long-enough'

describe('createJwtToken', () => {
  it('encodes the payload', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, { expiresIn: '1h' })
    expect(verifyJwtToken(token, SECRET).payload.userId).toBe('u1')
  })

  it('rejects an invalid secret', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, { expiresIn: '1h' })
    expect(() => verifyJwtToken(token, 'wrong')).toThrow('Invalid token')
  })
})
```

**Conventions:**

- One `describe` per public function or behavior cluster.
- Test names start with a verb: `'returns ...'`, `'throws ...'`, `'rejects ...'`.
- Reset shared state in `beforeEach` (`vi.clearAllMocks()`, `resetPrismaMock()`).
- Prefer many small `it()` cases over a few long ones with multiple assertions.
- Cover **golden path + error path + edge cases** for every public export.

See [apps/web/tests/unit/lib/jwt.test.ts](../apps/web/tests/unit/lib/jwt.test.ts) for a representative example.

---

## Writing API Integration Tests

API tests live under `tests/integration/api/`. They import the route handlers (`GET`, `POST`, etc.) directly and exercise them with a fabricated `NextRequest` — no live server, no live database.

**Skeleton (adapted from [cards.test.ts](../apps/web/tests/integration/api/cards.test.ts)):**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardFixture } from '@/tests/helpers/fixtures'
import { AuthorizationError } from '@/types/server/errors'

// 1. Mock cross-cutting concerns BEFORE importing the route
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({ checkRequestLimits: vi.fn() }))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticateWithRole: vi.fn() }))

// 2. Import AFTER mocks are in place
import { GET } from '@/app/api/cards/route'
import { authenticateWithRole } from '@/lib/auth/unified-auth'

const ADMIN_PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards', () => {
  it('returns cards for an admin caller', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({
      pubkey: ADMIN_PUBKEY,
      role: 'ADMIN' as any,
      method: 'nip98',
    })
    const card = createCardFixture()
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([card] as any)

    const res = await GET(createNextRequest('/api/cards'))
    const body: any = await assertResponse(res, 200)
    expect(body).toHaveLength(1)
  })

  it('rejects unauthorized callers with 403', async () => {
    vi.mocked(authenticateWithRole).mockRejectedValue(
      new AuthorizationError('Not authorized')
    )
    const res = await GET(createNextRequest('/api/cards'))
    expect(res.status).toBe(403)
  })
})
```

**Order matters:** every `vi.mock()` must run *before* the route module is imported, because Next.js route handlers wire up middleware at module load. Get this wrong and your mocks silently no-op.

For dynamic routes like `/api/cards/[id]`, wrap params with `createParamsPromise` from [route-helpers.ts](../apps/web/tests/helpers/route-helpers.ts):

```ts
const ctx = createParamsPromise({ id: 'card_123' })
const res = await GET(req, ctx)
```

---

## Mocking Strategies

### Prisma — `tests/helpers/prisma-mock.ts`

Every Prisma model is replaced with a deep mock that has independent `vi.fn()` stubs per method (`findUnique`, `findMany`, `create`, …). The mock is wired in automatically via:

```ts
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
```

Inside [`prisma-mock.ts`](../apps/web/tests/helpers/prisma-mock.ts) — so route tests get the mock for free. Override return values per test:

```ts
vi.mocked(prismaMock.user.findUnique).mockResolvedValue(createUserFixture({ role: 'ADMIN' }))
vi.mocked(prismaMock.card.create).mockRejectedValue(new Error('db down'))
```

`$transaction` is pre-wired to invoke the callback with the same mock client. Always call `resetPrismaMock()` in `beforeEach` — `vi.clearAllMocks()` only clears call history, not stored return values.

### MSW — outbound HTTP

Default handlers live in [tests/mocks/handlers.ts](../apps/web/tests/mocks/handlers.ts) and currently mock Alby and Veintiuno. The server is started in [setup.ts](../apps/web/tests/setup.ts) and resets handlers after every test. Override per test:

```ts
import { http, HttpResponse } from 'msw'
import { server } from '@/tests/mocks/server'

it('handles Alby 5xx', async () => {
  server.use(
    http.post('https://api.getalby.com/*', () =>
      HttpResponse.json({ error: 'down' }, { status: 503 })
    )
  )
  // ... call the route, assert
})
```

### Config — `vi.mock('@/lib/config')`

`getConfig()` caches its result, so always mock it explicitly when the code under test reads config. For tests that need to flip env values per case (config/env modules themselves), use `vi.resetModules()` plus dynamic `await import(...)`:

```ts
beforeEach(() => {
  vi.resetModules()
})

it('reads MAINTENANCE_MODE from env', async () => {
  process.env.MAINTENANCE_MODE = 'true'
  const { getConfig } = await import('@/lib/config')
  expect(getConfig().maintenance.enabled).toBe(true)
})
```

For typical tests, use [`createDefaultConfig()`](../apps/web/tests/helpers/route-helpers.ts) to get a sane baseline and override only what matters.

### Logger — must mock before import

`lib/logger.ts` calls `getConfig()` at module load. If a test imports the logger before config is mocked, you get the real config and a confusing error. Always mock the logger as a no-op in route tests:

```ts
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))
```

### Auth — NIP-98 / JWT / unified

Three flavors, all in [auth-helpers.ts](../apps/web/tests/helpers/auth-helpers.ts):

- `mockNip98(pubkey?)` — replaces `validateNip98` with a stub that returns a valid result.
- `mockAdminAuth(pubkey?)` — replaces both NIP-98 and admin-auth validators.
- `createJwtPayload(overrides)` — builds a payload object for JWT-related assertions.

For route handlers that go through the unified auth chain, mock `authenticateWithRole` directly:

```ts
vi.mocked(authenticateWithRole).mockResolvedValue({
  pubkey: 'a'.repeat(64),
  role: 'ADMIN' as any,
  method: 'nip98',
})
```

### Fixtures — `tests/helpers/fixtures.ts`

Faker-backed factories for every Prisma model. Always pass overrides for fields the test asserts on; let the rest randomize. This catches accidental coupling to specific data values.

```ts
const card = createCardFixture({ otc: 'test-otc-value' })
const admin = createAdminUserFixture({ pubkey: 'a'.repeat(64) })
```

---

## Helpers Reference

| Helper | File | Purpose |
|--------|------|---------|
| `createNextRequest(url, opts)` | `api-helpers.ts` | Build a `NextRequest` for route tests |
| `assertResponse(res, status)` | `api-helpers.ts` | Assert status + parse JSON, throws on mismatch |
| `getResponseJson(res)` | `api-helpers.ts` | Parse JSON without status assertion |
| `prismaMock` | `prisma-mock.ts` | Deep PrismaClient mock |
| `resetPrismaMock()` | `prisma-mock.ts` | Reset mock state in `beforeEach` |
| `createParamsPromise(params)` | `route-helpers.ts` | Wrap dynamic route params (App Router style) |
| `createDefaultConfig(overrides)` | `route-helpers.ts` | Sane `AppConfig` for tests |
| `mockNip98(pubkey?)` | `auth-helpers.ts` | Stub NIP-98 validation |
| `mockAdminAuth(pubkey?)` | `auth-helpers.ts` | Stub admin auth |
| `createJwtPayload(overrides)` | `auth-helpers.ts` | Build a JWT payload object |
| `createMockRequest(url, opts)` | `auth-helpers.ts` | Plain `Request` (not Next-specific) |
| `createJsonRequest(url, body)` | `auth-helpers.ts` | `Request` with JSON body |
| `createUserFixture(overrides)` | `fixtures.ts` | Faker User |
| `createAdminUserFixture(overrides)` | `fixtures.ts` | Faker User with `role: 'ADMIN'` |
| `createCardFixture(overrides)` | `fixtures.ts` | Faker Card |
| `createCardDesignFixture(overrides)` | `fixtures.ts` | Faker CardDesign |
| `createLightningAddressFixture(overrides)` | `fixtures.ts` | Faker LightningAddress |
| `createSettingsFixture(overrides)` | `fixtures.ts` | Faker Settings KV |
| `createNtag424Fixture(overrides)` | `fixtures.ts` | Faker NTAG424 |

---

## Coverage Requirements

The Vitest config enforces global thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 60% |
| Branches | 75% |
| Functions | 70% |
| Lines | 60% |

Coverage is computed over `app/api/**`, `lib/**`, and `hooks/**`. The following are excluded by design: `tests/`, `mocks/`, `**/*.config.*`, `**/types/**`, `prisma/`, and `lib/client/**` (the latter is browser code that requires a real DOM and component-level testing — covered separately as the component test suite grows).

**A PR fails CI if any threshold drops.** Always run `pnpm test:coverage` locally before opening a PR that touches lib or API code. If you intentionally lower coverage (e.g. removing a tested module), call it out in the PR description.

The numbers above are a floor, not a target. New API routes and lib utilities should aim for 90%+ — the global threshold is intentionally lower to absorb hard-to-test code (third-party adapters, error fallback branches).

---

## Best Practices

1. **Test behavior, not implementation.** Assert what callers observe (return value, response body, side effect on the mock). Do not assert internal call counts unless the side effect *is* the contract.
2. **One assertion concept per `it`.** Multiple `expect()` lines are fine when they describe one outcome ("response is 200 *and* body has shape X"); avoid unrelated assertions in one case.
3. **Name tests as sentences.** `it('returns 404 when card is missing')` is better than `it('not found')`.
4. **Always mock at the boundary.** Mock `@/lib/prisma`, `@/lib/config`, `@/lib/logger`, third-party SDKs. Do not mock the module under test — that produces tautological tests.
5. **Use fixtures over literal objects.** Fixtures fill in irrelevant fields with random data, which catches accidental coupling and forces tests to declare what they actually care about.
6. **Reset state in `beforeEach`.** `resetPrismaMock()` + `vi.clearAllMocks()`. Assume nothing carries over from the previous test.
7. **Prefer `mockReset()` over `mockClear()`** when you need to drop both call history and stored return values. `vi.clearAllMocks()` is the former; `vi.resetAllMocks()` is the latter.
8. **Test the unhappy path.** For every public function: golden case, validation failure, auth failure, dependency failure. The error path is where bugs hide.
9. **Keep tests fast.** No `setTimeout`, no real network, no real DB. Total wall time today is ~4 seconds — guard it.
10. **Co-locate test data with the test.** Inline fixtures and constants, unless they are reused across files. A test that requires reading three other files to understand is broken.
11. **Skip with intent.** `it.skip()` and `it.todo()` are fine for tracking; CI will surface the count. Never commit `.only()`.

---

## Common Pitfalls

**Mocks declared after the import.** `vi.mock()` is hoisted by Vitest, but only when called at the *top* of a file. Mixing `vi.mock` with imports that depend on it in unexpected order produces silent test failures where the real module loads instead of the mock. Rule of thumb: mocks first, imports second, never the reverse.

**Logger imports at module load.** `lib/logger.ts` calls `getConfig()` synchronously. If a route test doesn't mock the logger, importing the route handler also resolves config — and the test crashes if `JWT_SECRET` is unset in the test env. Mock the logger every time.

**`vi.clearAllMocks()` vs `mockReset()`.** `clearAllMocks()` only zeroes call history. If a previous test set `mockResolvedValue(x)` and the next test doesn't override it, `x` carries over. Use `resetPrismaMock()` (which calls `mockReset()` internally) to fully reset Prisma between tests, and `vi.resetAllMocks()` if you need to reset everything.

**Caching in `getConfig` / `getEnv`.** Both cache after first call. To re-read env in a test, use `vi.resetModules()` and dynamic `await import()` so the module is re-loaded with the new env.

**Async route params.** Next.js App Router 15+ requires params to be a `Promise`. Use `createParamsPromise({ id: '...' })` — passing a plain object will compile but explode at runtime.

**MSW `onUnhandledRequest: 'warn'`.** A test that hits an unmocked URL prints a warning but doesn't fail. If a third-party call lands silently in the test logs, add a handler to `mocks/handlers.ts` or `server.use()` it inline.

**`process.env` mutation.** Set in `beforeEach`, restore in `afterEach`. Tests that stomp `process.env` without restoring it leak state into every later test in the file.

---

## CI Integration

GitHub Actions runs `lint → typecheck → test` on every PR. Branch protection requires green status checks before merge to `main`. Coverage reports are uploaded to Codecov (planned).

Locally, the pre-flight check before opening a PR:

```bash
pnpm --filter @lawallet-nwc/web lint
pnpm --filter @lawallet-nwc/web typecheck
pnpm --filter @lawallet-nwc/web test
pnpm --filter @lawallet-nwc/web test:coverage
```

If any of these fail, fix the cause — never disable the check.

---

## Roadmap

| Month | Addition |
|-------|----------|
| 3 | Playwright multi-browser smoke, visual regression baseline, admin dashboard E2E |
| 4 | User dashboard E2E, NWC redirect flows, visual regression updates |
| 5 | Lightning compliance flows, webhook delivery, redirect resolution |
| 6 | Deployment smoke tests, full regression across all three services |

See [docs/ROADMAP.md](ROADMAP.md) for the broader plan.

---

## Reference

- [Vitest docs](https://vitest.dev)
- [MSW docs](https://mswjs.io/docs)
- [Testing Library](https://testing-library.com)
- [Faker.js](https://fakerjs.dev)
- Codebase examples: [cards.test.ts](../apps/web/tests/integration/api/cards.test.ts), [jwt.test.ts](../apps/web/tests/unit/lib/jwt.test.ts), [config.test.ts](../apps/web/tests/unit/lib/config.test.ts)
