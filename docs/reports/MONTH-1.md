# Progress Report — Month 1

**Project:** LaWallet NWC
**Period:** January 5 – February 5, 2026
**Grant:** [OpenSats — Fifteenth Wave of Bitcoin Grants](https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants)

---

## Summary

The first month focused on building a solid backend foundation. We exceeded the original scope by pulling work forward from Months 2 and 3 — delivering structured logging, JWT authentication, RBAC authorization, and full integration test coverage ahead of schedule. The result is a hardened, well-tested backend ready to support the SDK, dashboards, and new services planned for the coming months.

**Stats:** 118 files changed, 13,391 insertions, 3,215 deletions — 66 commits across 18 merged PRs.

---

## What Was Delivered

### Configuration & Environment ([PR #137](https://github.com/lawalletio/lawallet-nwc/pull/137))

- Zod-based environment variable validation replacing raw `process.env` access
- Structured `AppConfig` with per-environment configuration and caching

### Error Handling ([PR #138](https://github.com/lawalletio/lawallet-nwc/pull/138), [PR #139](https://github.com/lawalletio/lawallet-nwc/pull/139))

- `ApiError` class hierarchy with typed error responses
- `withErrorHandling` higher-order function applied to all 30 API routes

### Structured Logging ([PR #165](https://github.com/lawalletio/lawallet-nwc/pull/165), [PR #166](https://github.com/lawalletio/lawallet-nwc/pull/166))

- Pino logger with request context, correlation IDs, and configurable log levels
- Replaced all `console.log`/`console.error` calls across the codebase

### Authorization & Security ([PR #168](https://github.com/lawalletio/lawallet-nwc/pull/168)–[PR #171](https://github.com/lawalletio/lawallet-nwc/pull/171), [commit `ee8629b`](https://github.com/lawalletio/lawallet-nwc/commit/ee8629b))

- RBAC model with four roles: USER < VIEWER < OPERATOR < ADMIN
- Prisma schema migration from string to enum for user roles
- Role management API endpoint with hierarchy validation
- Maintenance mode middleware with admin bypass

### Input Validation ([PR #173](https://github.com/lawalletio/lawallet-nwc/pull/173), [PR #174](https://github.com/lawalletio/lawallet-nwc/pull/174), [PR #175](https://github.com/lawalletio/lawallet-nwc/pull/175))

- Centralized Zod validation schemas for all API inputs
- Validation middleware applied to every route

### Security Middleware ([PR #178](https://github.com/lawalletio/lawallet-nwc/pull/178), [PR #179](https://github.com/lawalletio/lawallet-nwc/pull/179))

- Rate limiting for public endpoints
- Request size limits (body size and file upload constraints)

### Testing Infrastructure ([PR #176](https://github.com/lawalletio/lawallet-nwc/pull/176), [PR #180](https://github.com/lawalletio/lawallet-nwc/pull/180))

- Vitest 3.2.4 with MSW mock server, happy-dom, and coverage thresholds
- 12 unit test suites covering all lib utilities and auth functions
- 21 integration test files covering all 32 API route handlers (154 tests)

### Framework Upgrade ([PR #167](https://github.com/lawalletio/lawallet-nwc/pull/167), [PR #177](https://github.com/lawalletio/lawallet-nwc/pull/177))

- Next.js 16 with ESLint 9 flat config
- Migrated `@getalby/sdk` to v7 and `react-resizable-panels` to v4

---

## Epics Completed (7)

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

## Next Quarter (Feb – Apr 2026)

With the backend foundation complete — including testing infrastructure, error handling, auth, and security middleware — the next quarter focuses on developer tooling and user-facing features. Month 2 wraps up CI/CD pipelines, a TypeScript Client SDK covering all 30 API endpoints, and a React Hooks package. Month 3 shifts to the frontend: enhancing the Admin Dashboard with user management and activity monitoring, adding Nostr login (NIP-07/NIP-46), and introducing Playwright E2E tests. Month 4 delivers the User Dashboard (profile, NWC connection, address management), launches the Courtesy NWC Proxy as a new containerized service, and adds white-label customization support.

See the full [ROADMAP](../ROADMAP.md) for the 6-month timeline.

---

## Links

- **Repository:** [github.com/lawalletio/lawallet-nwc](https://github.com/lawalletio/lawallet-nwc)
- **Full changelog:** [MONTH-1.md](../changelogs/MONTH-1.md)
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)
