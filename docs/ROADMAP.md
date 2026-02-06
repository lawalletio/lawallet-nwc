# Roadmap

## 6-Month Development Timeline

| Month | Phase | Status | Key Deliverables |
|-------|-------|--------|------------------|
| 1 | Foundation | **Completed** | Testing infra, error handling, config, logging, auth (JWT+RBAC), security middleware, validation, Next.js 16 |
| 2 | Foundation | **In Progress** | GitHub Actions CI/CD, TypeScript Client SDK, React Hooks package, hook tests |
| 3 | Enhancement | Planned | Admin Dashboard enhancement, NIP-07/NIP-46 Nostr login, frontend cleanup, Playwright E2E |
| 4 | Enhancement | Planned | **User Dashboard** (profile, npub/NIP-05, preferences), Courtesy NWC Proxy (new container), wallet polish, white-label |
| 5 | Expansion | Planned | LUD-16/21/22, NIP-57 zaps, NWC Payment Listener (new container), alias/redirect, SDK update |
| 6 | Expansion | Planned | Documentation, deployment (Vercel/Netlify/Umbrel/Start9/Docker), security prep |

---

## Phase 1: Foundation (Months 1-2)

### Month 1: Backend Infrastructure + Testing (COMPLETED)

Exceeded original scope. Delivered 90% of the backend infrastructure:

- Vitest + MSW + 154 integration tests covering all 32 routes
- Error handling (ApiError hierarchy + withErrorHandling)
- Configuration (Zod env validation + AppConfig)
- Pino structured logging (originally Month 2)
- JWT auth + RBAC with 4 roles (originally Month 3)
- Security middleware (rate limiting, request limits, maintenance mode)
- Zod validation for all API inputs
- Next.js 16 + ESLint 9 upgrade

### Month 2: CI/CD + Client SDK + React Hooks (IN PROGRESS)

With logging, auth, and integration tests done early:

- GitHub Actions CI/CD pipeline (carried from Month 1)
- TypeScript Client SDK (npm package, all 30 endpoints)
- React Hooks package (`@lawallet-nwc/react`, 7 hooks)
- Hook unit tests for existing 9 hooks
- Coverage improvement to 60%+

---

## Phase 2: Enhancement (Months 3-4)

### Month 3: Admin Dashboard Enhancement + Nostr Login + E2E

Backend auth already complete; focus on frontend:

- Admin Dashboard: user management, activity monitor, logs panel, address enhancements
- NIP-07 browser extension login + NIP-46 remote signing
- Frontend component cleanup and SDK hook consumption
- Playwright multi-browser E2E testing

### Month 4: User Dashboard + Courtesy NWC Proxy + Wallet Polish

- **User Dashboard**: profile, npub/NIP-05 setup, address config, redirect management, NWC connection, preferences
- Courtesy NWC Proxy service (new container, 5 provider adapters)
- Wallet polish: payment history, receive interface, improved NWC flow
- White-label customization + customizable landing page
- E2E continued

---

## Phase 3: Expansion (Months 5-6)

### Month 5: Lightning Compliance + NWC Listener

- LUD-16 full compliance (with alias/redirect)
- NIP-57 zaps
- LUD-21 verify endpoint
- LUD-22 webhooks
- NWC Payment Listener service (new container)
- SDK + Hooks update

### Month 6: Docs + Deployment

- API documentation (OpenAPI/Swagger for 30 routes)
- Codebase documentation (expand ARCHITECTURE.md, CONTRIBUTING.md)
- Deployment configs (Vercel, Netlify, Umbrel, Start9, Docker)
- Security preparation and audit readiness

---

## Post-Grant Vision

See [VISION.md](./VISION.md) for the CRM + AI + Nostr communications roadmap (months 7+).

---

## What Already Exists (as of Month 1)

Understanding the current state helps contextualize the roadmap:

| Area | State |
|------|-------|
| API Routes | 30 handlers, all with error handling, validation, auth |
| Admin Dashboard | Functional (cards, designs, addresses, settings) |
| Wallet UI | Functional (login, balance, send, NWC setup, settings) |
| Landing Page | Full page with waitlist, roadmap, supporters |
| Auth Backend | JWT + NIP-98 + RBAC (4 roles) + maintenance mode |
| Testing | 14 unit + 21 integration test files (154 tests) |
| Database | 6 models (User, Card, CardDesign, Ntag424, LightningAddress, AlbySubAccount, Settings) |
| NFC Cards | Full NTAG424 encryption, scan, write, OTC activation |
| Alby Integration | Sub-account management via `@getalby/sdk` v7 |

---

## Lightning Address Priority

| Feature | Standard | Month |
|---------|----------|-------|
| Base lightning address | LUD-16 | 5 |
| Zaps | NIP-57 | 5 |
| Verify endpoint | LUD-21 | 5 |
| Webhooks | LUD-22 | 5 |
| Address redirect | -- | 5 |
| Address management (admin) | -- | 3 |
| User dashboard + npub | -- | 4 |
| Courtesy NWC (Alby, LNBits, etc.) | -- | 4 |

---

## New Containers Timeline

| Month | Container | Service |
|-------|-----------|---------|
| 4 | `lawallet-nwc-proxy` | Courtesy NWC Proxy |
| 5 | `lawallet-listener` | NWC Payment Listener |
