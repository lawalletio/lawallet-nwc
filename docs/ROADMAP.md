# Roadmap

## 6-Month Development Timeline

| Month | Phase | Status | Key Deliverables |
|-------|-------|--------|------------------|
| 1 | Foundation | **Completed** | Full backend testing infrastructure, error handling, config, logging, auth (JWT+RBAC), security middleware, validation, Next.js 16 |
| 2 | Foundation | **In Progress** | GitHub Actions CI/CD, React components and hooks, TypeScript SDK, hook tests, backend coverage ramp toward 95% |
| 3 | Enhancement | **In Progress** | Full frontend dashboard implementation, Figma implementation, NIP-07/NIP-46 Nostr login, frontend cleanup, Playwright E2E testing |
| 4 | Enhancement | Planned | **User Dashboard** (profile, npub/NIP-05, preferences), Courtesy NWC Proxy (new container), wallet polish, white-label, customizable landing |
| 5 | Expansion | Planned | Lightning compliance (LUD-16, NIP-57, LUD-21, LUD-22/webhooks), NWC Payment Listener (new container), alias/redirect, SDK + Hooks update |
| 6 | Expansion | Planned | Full backend documentation, API documentation (OpenAPI/Swagger), deployment configs (Vercel/Netlify/Umbrel/Start9/Docker), Umbrel + Start9 deployment, security preparation and audit readiness |

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

### Month 2: CI/CD + SDK + React Components/Hooks (IN PROGRESS)

With logging, auth, and integration tests done early:

- GitHub Actions CI/CD pipeline (carried from Month 1)
- TypeScript Client SDK (npm package, all 30 endpoints)
- React Hooks package (`@lawallet-nwc/react`) and reusable React component foundations
- Hook unit tests and broader frontend integration coverage
- Backend coverage ramp toward 95%

---

## Phase 2: Enhancement (Months 3-4)

### Month 3: Full Frontend Dashboard + Figma Implementation + E2E

Backend auth already complete; focus on frontend:

- Full frontend dashboard implementation: user management, activity monitor, logs panel, address enhancements
- Figma implementation across the admin/dashboard experience
- NIP-07 browser extension login + NIP-46 remote signing
- Frontend component cleanup and SDK/hook consumption
- Playwright multi-browser E2E testing and coverage

### Month 4: User Dashboard + Courtesy NWC Proxy + Wallet Polish

- **User Dashboard**: profile, npub/NIP-05 setup, address config, redirect management, NWC connection, preferences
- Courtesy NWC Proxy service (new container, 5 provider adapters)
- Wallet polish: payment history, receive interface, improved NWC flow
- White-label customization + customizable landing page
- Continued E2E coverage expansion

---

## Phase 3: Expansion (Months 5-6)

### Month 5: Lightning Compliance + NWC Listener

- LUD-16 full compliance (with alias/redirect)
- NIP-57 zaps
- LUD-21 verify endpoint
- LUD-22 webhooks
- NWC Payment Listener service (new container)
- SDK + Hooks update
- Consolidated Lightning compliance milestone for LUD-16, NIP-57, LUD-21, and webhooks

### Month 6: Docs + Deployment

- API documentation (OpenAPI/Swagger for 30 routes)
- Full backend documentation (expand ARCHITECTURE.md, CONTRIBUTING.md, service docs)
- Deployment configs (Vercel, Netlify, Umbrel, Start9, Docker)
- Umbrel + Start9 deployment support
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
| Testing | Strong backend test foundation in place; roadmap target is full backend coverage toward 95% plus Playwright E2E coverage |
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
