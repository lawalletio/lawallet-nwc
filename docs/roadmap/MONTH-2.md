# Month 2: CI/CD + Client SDK + React Hooks

**Period:** February 5 - March 5, 2026
**Status:** In Progress
**Depends on:** Month 1 (completed)

## Summary

With backend infrastructure, logging, auth, and testing delivered ahead of schedule in Month 1, this month focuses on CI/CD automation, building the public-facing SDK packages, and improving test coverage for hooks.

---

## Goals

- Set up GitHub Actions CI/CD pipeline
- Build and publish TypeScript Client SDK
- Build and publish React Hooks package
- Unit tests for custom hooks
- Improve coverage targets incrementally

---

## CI/CD Pipeline (Carried from Month 1)

### GitHub Actions Workflow

- **lint**: ESLint + Prettier checks
- **typecheck**: TypeScript compilation verification
- **test**: Vitest execution with coverage reporting
- **build**: Next.js production build verification

### Quality Gates

- PR status checks required for merge (all jobs must pass)
- Branch protection on `main`
- Coverage upload to Codecov (or similar)
- Automated build verification on push

---

## TypeScript Client SDK

### Scope

- Typed client for all 30 backend API endpoints
- Lightning address operations: create, lookup, delete
- Card management: CRUD, scan, write, OTC activation
- User management: profile, role, NWC URI
- Authentication helpers: NIP-98 login → JWT session, unified auth (Nostr + Bearer)
- Admin operations: settings, assign roles

### Technical

- Auto-generated TypeScript types from existing Zod schemas
- Published as standalone npm package
- Unit tests with MSW mocks
- README with usage examples

---

## React Hooks Package

### Hooks

| Hook | Purpose | Features |
|------|---------|----------|
| `useAddress` | CRUD single lightning address | Create, fetch, update, delete |
| `useAddresses` | List/search addresses | Pagination, filtering, search |
| `useNWCConnection` | NWC wallet management | Connect, disconnect, status polling |
| `usePayments` | Payment history | Real-time updates, filtering |
| `useAuth` | Authentication | NIP-98 login → JWT session, session state, logout |
| `useWebhooks` | Webhook management | Subscribe, unsubscribe, list active |
| `useWallet` | Wallet operations | Balance, send, receive, NWC status |

### Technical

- Built on top of Client SDK
- SWR or React Query integration for caching + revalidation
- Loading, error, and success states on every hook
- TypeScript generics for type-safe responses
- Unit tests with React Testing Library
- Published as `@lawallet-nwc/react`

---

## Hook Unit Tests

- Unit tests for all 9 existing hooks in `/hooks`
- Test state transitions, error handling, loading states
- Mock API responses with MSW
- Coverage target: 60%+ on `/hooks` and `/lib`

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| GitHub Actions | All jobs (lint, typecheck, test, build) pass on PRs | P0 |
| Branch protection | `main` requires passing CI | P0 |
| Client SDK | All endpoints covered, types generated, npm published | P0 |
| React Hooks | 7 hooks, tests passing, npm published | P0 |
| Hook tests | All 9 existing hooks have unit tests | P1 |
| Coverage | 60%+ on /hooks and /lib | P1 |
