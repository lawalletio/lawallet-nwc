# Changelog

## Period: January 5 – February 5, 2026

**Base commit:** [`7f0a632`](https://github.com/lawalletio/lawallet-nwc/commit/7f0a632) — _Implement GitHub issue and epic creation scripts_
**Head commit:** [`fd2296b`](https://github.com/lawalletio/lawallet-nwc/commit/fd2296b) — _Merge pull request [#180](https://github.com/lawalletio/lawallet-nwc/pull/180)_

**Stats:** 118 files changed, 13,391 insertions, 3,215 deletions — 66 commits (18 PRs merged)

**Contributors:** Agustin Kassis (62 commits), claudiomolt (4 commits)

---

## Epics Completed

| Epic | Title | Closed |
|------|-------|--------|
| [#128](https://github.com/lawalletio/lawallet-nwc/issues/128) | Bug Fixes & Critical Issues | Jan 15 |
| [#129](https://github.com/lawalletio/lawallet-nwc/issues/129) | Error Handling & Infrastructure | Jan 15 |
| [#131](https://github.com/lawalletio/lawallet-nwc/issues/131) | Configuration & Environment | Jan 15 |
| [#130](https://github.com/lawalletio/lawallet-nwc/issues/130) | Logging & Observability | Jan 23 |
| [#132](https://github.com/lawalletio/lawallet-nwc/issues/132) | Authorization & Security | Jan 30 |
| [#133](https://github.com/lawalletio/lawallet-nwc/issues/133) | Security Middleware | Feb 5 |
| [#134](https://github.com/lawalletio/lawallet-nwc/issues/134) | Testing Infrastructure | Feb 5 |

---

## Issues Closed (18)

### Configuration & Environment (Epic [#131](https://github.com/lawalletio/lawallet-nwc/issues/131))

- **[#105](https://github.com/lawalletio/lawallet-nwc/issues/105)** — Add environment variable schema and validation using zod/envsafe ([PR #137](https://github.com/lawalletio/lawallet-nwc/pull/137))
- **[#106](https://github.com/lawalletio/lawallet-nwc/issues/106)** — Create backend config loader with per-environment configuration ([PR #137](https://github.com/lawalletio/lawallet-nwc/pull/137))

### Error Handling & Infrastructure (Epic [#129](https://github.com/lawalletio/lawallet-nwc/issues/129))

- **[#101](https://github.com/lawalletio/lawallet-nwc/issues/101)** — Create error handling infrastructure ([PR #138](https://github.com/lawalletio/lawallet-nwc/pull/138))
  - Added `ApiError` class hierarchy, `handleApiError`, `withErrorHandling` HOF
  - New `ConflictError` class, optional headers support
- **[#102](https://github.com/lawalletio/lawallet-nwc/issues/102)** — Refactor all API routes to use standardized error handling ([PR #139](https://github.com/lawalletio/lawallet-nwc/pull/139))

### Logging & Observability (Epic [#130](https://github.com/lawalletio/lawallet-nwc/issues/130))

- **[#103](https://github.com/lawalletio/lawallet-nwc/issues/103)** — Setup Pino logger with structured logging ([PR #165](https://github.com/lawalletio/lawallet-nwc/pull/165))
  - Pino + pino-pretty integration, request context, log levels via env
- **[#104](https://github.com/lawalletio/lawallet-nwc/issues/104)** — Replace all console.log/error calls with Pino structured logging ([PR #166](https://github.com/lawalletio/lawallet-nwc/pull/166))
  - Request logging middleware, `logPretty` config option

### Authorization & Security (Epic [#132](https://github.com/lawalletio/lawallet-nwc/issues/132))

- **[#107](https://github.com/lawalletio/lawallet-nwc/issues/107)** — Define roles & permissions model with authorization utilities ([PR #168](https://github.com/lawalletio/lawallet-nwc/pull/168))
  - RBAC model: USER < VIEWER < OPERATOR < ADMIN
- **[#108](https://github.com/lawalletio/lawallet-nwc/issues/108)** — Update Prisma schema to use enum for User roles ([PR #169](https://github.com/lawalletio/lawallet-nwc/pull/169))
- **[#109](https://github.com/lawalletio/lawallet-nwc/issues/109)** — Create Prisma migration for role enum and update existing data ([PR #170](https://github.com/lawalletio/lawallet-nwc/pull/170))
- **[#110](https://github.com/lawalletio/lawallet-nwc/issues/110)** — Create API endpoint to add and modify user roles with hierarchy validation ([PR #171](https://github.com/lawalletio/lawallet-nwc/pull/171))
- **[#111](https://github.com/lawalletio/lawallet-nwc/issues/111)** — Add maintenance mode feature flag (env-driven) with middleware (commit [`ee8629b`](https://github.com/lawalletio/lawallet-nwc/commit/ee8629b))

### Validation & Input Sanitization

- **[#112](https://github.com/lawalletio/lawallet-nwc/issues/112)** — Create Zod validation schemas for all API inputs ([PR #173](https://github.com/lawalletio/lawallet-nwc/pull/173))
  - Centralized schema module with validation middleware
- **[#113](https://github.com/lawalletio/lawallet-nwc/issues/113)** — Refactor all API routes to use Zod validation schemas ([PR #174](https://github.com/lawalletio/lawallet-nwc/pull/174), [PR #175](https://github.com/lawalletio/lawallet-nwc/pull/175))

### Security Middleware (Epic [#133](https://github.com/lawalletio/lawallet-nwc/issues/133))

- **[#114](https://github.com/lawalletio/lawallet-nwc/issues/114)** — Add rate limiting middleware for public endpoints ([PR #178](https://github.com/lawalletio/lawallet-nwc/pull/178))
- **[#115](https://github.com/lawalletio/lawallet-nwc/issues/115)** — Add request size limits (body size and file upload constraints) middleware ([PR #179](https://github.com/lawalletio/lawallet-nwc/pull/179))

### Testing Infrastructure (Epic [#134](https://github.com/lawalletio/lawallet-nwc/issues/134))

- **[#116](https://github.com/lawalletio/lawallet-nwc/issues/116)** — Configure Vitest with coverage, test utilities, mocks, and helpers ([PR #176](https://github.com/lawalletio/lawallet-nwc/pull/176))
  - Vitest 3.2.4, MSW server, happy-dom, coverage thresholds
- **[#117](https://github.com/lawalletio/lawallet-nwc/issues/117)** — Write unit tests for all lib utilities, auth functions, and validation
  - 12 unit test suites: permissions, JWT, jwt-auth, nostr, NIP-98, admin-auth, config, errors, logger, maintenance, utils, prisma-mock
- **[#118](https://github.com/lawalletio/lawallet-nwc/issues/118)** — Write integration tests for all API routes ([PR #180](https://github.com/lawalletio/lawallet-nwc/pull/180))
  - 21 integration test files covering all 32 route handlers (154 tests)

---

## Framework & Dependencies

- **Next.js 16 upgrade** with ESLint 9 flat config ([PR #167](https://github.com/lawalletio/lawallet-nwc/pull/167))
  - Fixed HTML structure in AddressesPage
  - Resolved ESLint errors for React best practices
  - Added dynamic export to API routes
- **Dependency updates** ([PR #177](https://github.com/lawalletio/lawallet-nwc/pull/177))
  - Migrated `@getalby/sdk` to v7 API
  - Migrated `react-resizable-panels` to v4 API
  - Converted configs to ESM syntax

---

## Pull Requests Merged

| PR | Branch | Description |
|----|--------|-------------|
| [#137](https://github.com/lawalletio/lawallet-nwc/pull/137) | `envsafe` | Environment variable validation with Zod |
| [#138](https://github.com/lawalletio/lawallet-nwc/pull/138) | `101-create-error-handling-infrastructure` | Error handling infrastructure |
| [#139](https://github.com/lawalletio/lawallet-nwc/pull/139) | `102-refactor-all-api-routes-to-use-standardized-error-handling` | Standardized error handling across all routes |
| [#165](https://github.com/lawalletio/lawallet-nwc/pull/165) | `103-pino` | Pino structured logging setup |
| [#166](https://github.com/lawalletio/lawallet-nwc/pull/166) | `104-replace-logs-pino` | Replace console.log with Pino across API |
| [#167](https://github.com/lawalletio/lawallet-nwc/pull/167) | `nextjs-16` | Next.js 16 + ESLint 9 upgrade |
| [#168](https://github.com/lawalletio/lawallet-nwc/pull/168) | `107-roles-authorization` | RBAC roles and permissions model |
| [#169](https://github.com/lawalletio/lawallet-nwc/pull/169) | `108-update-prisma-schema` | Prisma UserRole enum schema change |
| [#170](https://github.com/lawalletio/lawallet-nwc/pull/170) | `109-prisma-migration` | Role enum data migration |
| [#171](https://github.com/lawalletio/lawallet-nwc/pull/171) | `110-create-api-endpoint-to-add-and-modify-user-roles` | Role management API endpoint |
| [#173](https://github.com/lawalletio/lawallet-nwc/pull/173) | `112-create-zod-validation-schemas-for-all-api-inputs` | Centralized Zod schemas |
| [#174](https://github.com/lawalletio/lawallet-nwc/pull/174) | `113-refactor-all-api-zod` | Apply Zod validation to all routes |
| [#175](https://github.com/lawalletio/lawallet-nwc/pull/175) | `feat/security-middleware-113` | Security middleware (Zod + upstream merge) |
| [#176](https://github.com/lawalletio/lawallet-nwc/pull/176) | `feat/testing-infrastructure-116` | Vitest infrastructure setup |
| [#177](https://github.com/lawalletio/lawallet-nwc/pull/177) | `upgrade-packages` | Dependency updates + migrations |
| [#178](https://github.com/lawalletio/lawallet-nwc/pull/178) | `feat/rate-limiting-114` | Rate limiting for public endpoints |
| [#179](https://github.com/lawalletio/lawallet-nwc/pull/179) | `feat/request-limits-115` | Request size limits middleware |
| [#180](https://github.com/lawalletio/lawallet-nwc/pull/180) | `feature/118-integration-tests-api-routes` | Integration tests for all API routes |

---

## Commit Log (non-merge, chronological)

| Commit | Message |
|--------|---------|
| [`bd6acf8`](https://github.com/lawalletio/lawallet-nwc/commit/bd6acf8) | Update README.md |
| [`3eaab5c`](https://github.com/lawalletio/lawallet-nwc/commit/3eaab5c) | chore: add envsafe package to dependencies |
| [`90e1636`](https://github.com/lawalletio/lawallet-nwc/commit/90e1636) | feat: add environment variable validation schema and utility functions |
| [`6b3941c`](https://github.com/lawalletio/lawallet-nwc/commit/6b3941c) | feat: implement application configuration module with environment variable loading and validation |
| [`3bd46ef`](https://github.com/lawalletio/lawallet-nwc/commit/3bd46ef) | refactor: replace environment variable usage with getConfig |
| [`cc12799`](https://github.com/lawalletio/lawallet-nwc/commit/cc12799) | chore: update .env.example |
| [`5a2cd9a`](https://github.com/lawalletio/lawallet-nwc/commit/5a2cd9a) | refactor: remove redundant name parameter from waitlist subscription |
| [`355cb90`](https://github.com/lawalletio/lawallet-nwc/commit/355cb90) | feat: add API response types and error handling utilities |
| [`b9555d9`](https://github.com/lawalletio/lawallet-nwc/commit/b9555d9) | feat: enhance waitlist subscription validation and error handling |
| [`7745045`](https://github.com/lawalletio/lawallet-nwc/commit/7745045) | feat: add ConflictError class to enhance error handling |
| [`98dc4b5`](https://github.com/lawalletio/lawallet-nwc/commit/98dc4b5) | feat: enhance error handling by adding optional headers to handleApiError and withErrorHandling functions |
| [`954a983`](https://github.com/lawalletio/lawallet-nwc/commit/954a983) | refactor all API routes to use the new error handling infrastructure |
| [`30232a3`](https://github.com/lawalletio/lawallet-nwc/commit/30232a3) | add pino and pino-pretty packages |
| [`dde02a8`](https://github.com/lawalletio/lawallet-nwc/commit/dde02a8) | feat: update .env.example to include logging configuration options |
| [`8ce2ed6`](https://github.com/lawalletio/lawallet-nwc/commit/8ce2ed6) | feat: implement centralized logging system with request context and error handling |
| [`fa582ed`](https://github.com/lawalletio/lawallet-nwc/commit/fa582ed) | feat: add logging configuration options to environment schema |
| [`d9f2105`](https://github.com/lawalletio/lawallet-nwc/commit/d9f2105) | feat: add logPretty option to AppConfig |
| [`4b05825`](https://github.com/lawalletio/lawallet-nwc/commit/4b05825) | feat: integrate request logging into error handling middleware |
| [`b81d2fd`](https://github.com/lawalletio/lawallet-nwc/commit/b81d2fd) | refactor: replace console logging with structured logging across API routes |
| [`a6cc5bf`](https://github.com/lawalletio/lawallet-nwc/commit/a6cc5bf) | chore: update caniuse-lite dependency version in pnpm-lock.yaml |
| [`e7f355d`](https://github.com/lawalletio/lawallet-nwc/commit/e7f355d) | feat: add dynamic export to API routes for forced dynamic rendering |
| [`a8e11c3`](https://github.com/lawalletio/lawallet-nwc/commit/a8e11c3) | feat: upgrade to Next.js 16 with ESLint 9 flat config |
| [`d609338`](https://github.com/lawalletio/lawallet-nwc/commit/d609338) | fix: resolve ESLint errors for React best practices |
| [`dfc3a5a`](https://github.com/lawalletio/lawallet-nwc/commit/dfc3a5a) | fix: correct HTML structure in AddressesPage component |
| [`392dab4`](https://github.com/lawalletio/lawallet-nwc/commit/392dab4) | feat: add RBAC roles and permissions model with authorization utilities |
| [`678ce26`](https://github.com/lawalletio/lawallet-nwc/commit/678ce26) | feat: convert user role from String to UserRole enum in Prisma schema |
| [`dc5e0f3`](https://github.com/lawalletio/lawallet-nwc/commit/dc5e0f3) | feat: migrate user role data and update column type to UserRole enum |
| [`8a31c2d`](https://github.com/lawalletio/lawallet-nwc/commit/8a31c2d) | feat: add role management API endpoint with hierarchy validation |
| [`ee8629b`](https://github.com/lawalletio/lawallet-nwc/commit/ee8629b) | feat: add maintenance mode middleware with admin bypass (#172) |
| [`8fae5fc`](https://github.com/lawalletio/lawallet-nwc/commit/8fae5fc) | feat: add centralized Zod validation schemas and middleware |
| [`b27391c`](https://github.com/lawalletio/lawallet-nwc/commit/b27391c) | refactor: migrate inline Zod schemas to central validation module |
| [`524ecbb`](https://github.com/lawalletio/lawallet-nwc/commit/524ecbb) | refactor: replace manual validation with Zod in card routes |
| [`0a78a52`](https://github.com/lawalletio/lawallet-nwc/commit/0a78a52) | refactor: replace manual validation with Zod in user routes |
| [`b3dee37`](https://github.com/lawalletio/lawallet-nwc/commit/b3dee37) | refactor: replace manual validation with Zod in remaining routes |
| [`e7deec4`](https://github.com/lawalletio/lawallet-nwc/commit/e7deec4) | refactor: migrate remaining routes to Zod validation |
| [`2134108`](https://github.com/lawalletio/lawallet-nwc/commit/2134108) | refactor(validation): apply Zod validation to API routes |
| [`095857d`](https://github.com/lawalletio/lawallet-nwc/commit/095857d) | feat(testing): setup Vitest infrastructure with coverage, MSW, and helpers |
| [`ca5d3d5`](https://github.com/lawalletio/lawallet-nwc/commit/ca5d3d5) | fix(vitest): clean up configuration formatting and remove unused import |
| [`47db21f`](https://github.com/lawalletio/lawallet-nwc/commit/47db21f) | fix: migrate @getalby/sdk to v7 API |
| [`87aee53`](https://github.com/lawalletio/lawallet-nwc/commit/87aee53) | fix: migrate react-resizable-panels to v4 API |
| [`e220873`](https://github.com/lawalletio/lawallet-nwc/commit/e220873) | fix: update test helpers for package compatibility |
| [`80ba713`](https://github.com/lawalletio/lawallet-nwc/commit/80ba713) | chore: convert configs to ESM syntax |
| [`8d51fb2`](https://github.com/lawalletio/lawallet-nwc/commit/8d51fb2) | chore(deps): update dependencies to latest versions |
| [`32c8582`](https://github.com/lawalletio/lawallet-nwc/commit/32c8582) | chore: add coverage directory to .gitignore |
| [`31fbb8e`](https://github.com/lawalletio/lawallet-nwc/commit/31fbb8e) | chore(vitest): lower coverage thresholds in configuration |
| [`cf8bd07`](https://github.com/lawalletio/lawallet-nwc/commit/cf8bd07) | fix: update action import path to include file extension |
| [`d92a612`](https://github.com/lawalletio/lawallet-nwc/commit/d92a612) | feat(security): add rate limiting middleware for public endpoints |
| [`cd99f93`](https://github.com/lawalletio/lawallet-nwc/commit/cd99f93) | feat(security): add request size limits middleware (#115) |
| [`2039a7a`](https://github.com/lawalletio/lawallet-nwc/commit/2039a7a) | test(utils): add unit tests for cn, formatDate, generateHexGroups |
| [`97f6106`](https://github.com/lawalletio/lawallet-nwc/commit/97f6106) | test(permissions): add unit tests for RBAC roles and permissions |
| [`816e366`](https://github.com/lawalletio/lawallet-nwc/commit/816e366) | test(jwt): add unit tests for JWT token creation, verification, and helpers |
| [`e6f003e`](https://github.com/lawalletio/lawallet-nwc/commit/e6f003e) | test(jwt-auth): add unit tests for JWT authentication middleware |
| [`4b6e8fc`](https://github.com/lawalletio/lawallet-nwc/commit/4b6e8fc) | test(nostr): add unit tests for Nostr key generation and conversions |
| [`ee45302`](https://github.com/lawalletio/lawallet-nwc/commit/ee45302) | test(nip98): add unit tests for NIP-98 URL generation, body parsing, and validation |
| [`efa6399`](https://github.com/lawalletio/lawallet-nwc/commit/efa6399) | test(admin-auth): add unit tests for admin auth, role resolution, and HOF wrappers |
| [`36aebd9`](https://github.com/lawalletio/lawallet-nwc/commit/36aebd9) | test(config): add unit tests for getEnv, getConfig, and config caching |
| [`32d91d2`](https://github.com/lawalletio/lawallet-nwc/commit/32d91d2) | test(errors): add unit tests for all ApiError subclasses |
| [`c54a9dd`](https://github.com/lawalletio/lawallet-nwc/commit/c54a9dd) | test(logger): add unit tests for request ID, logger creation, and request logging |
| [`6a06f40`](https://github.com/lawalletio/lawallet-nwc/commit/6a06f40) | test(maintenance): add unit tests for maintenance mode middleware |
| [`0a5d3a8`](https://github.com/lawalletio/lawallet-nwc/commit/0a5d3a8) | fix(prisma-mock): use independent mock instances per model and improve reset |
| [`b6fcd98`](https://github.com/lawalletio/lawallet-nwc/commit/b6fcd98) | test(helpers): add route-helpers with createParamsPromise and createDefaultConfig |
| [`c1fef90`](https://github.com/lawalletio/lawallet-nwc/commit/c1fef90) | test(api): add integration tests for settings and auth assignment routes |
| [`155557e`](https://github.com/lawalletio/lawallet-nwc/commit/155557e) | test(api): add integration tests for user management routes |
| [`9c6be65`](https://github.com/lawalletio/lawallet-nwc/commit/9c6be65) | test(api): add integration tests for card CRUD routes |
| [`d132814`](https://github.com/lawalletio/lawallet-nwc/commit/d132814) | test(api): add integration tests for card scan and lightning routes |
| [`26af6c7`](https://github.com/lawalletio/lawallet-nwc/commit/26af6c7) | test(api): add integration tests for JWT, card designs, and remote connections |
