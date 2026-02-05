# Roadmap

## 6-Month Development Timeline

| Month | Phase | Key Deliverables |
|-------|-------|------------------|
| 1 | Foundation | Vitest, Prisma test utils, MSW, GitHub Actions CI/CD, bug fixes |
| 2 | Foundation | Integration tests, pino logging, TypeScript Client SDK, React Hooks package |
| 3 | Enhancement | Frontend start, auth, **Admin Dashboard**, Courtesy NWC Proxy (new container), Playwright E2E |
| 4 | Enhancement | **User Dashboard** (profile, npub/NIP-05, preferences), frontend wallet completion |
| 5 | Expansion | LUD-16/21/22, NIP-57 zaps, NWC Payment Listener (new container), alias/redirect, SDK update |
| 6 | Expansion | Documentation, deployment (Vercel/Netlify/Umbrel/Start9/Docker), security prep |

---

## Phase 1: Foundation (Months 1–2)

### Month 1: Testing + CI/CD
- Vitest + React Testing Library + happy-dom
- Prisma test utilities
- MSW for API mocking
- GitHub Actions pipeline
- Bug triage and fixes

### Month 2: Integration Tests + SDK + Hooks
- NWC and lightning address integration tests
- Structured logging (pino)
- TypeScript Client SDK (npm package)
- React Hooks package (@lawallet-nwc/react)

---

## Phase 2: Enhancement (Months 3–4)

### Month 3: Admin Dashboard + Auth + Courtesy NWC + E2E
- Frontend reimplementation start
- JWT + Nostr authentication (NIP-07, NIP-46)
- **Admin Dashboard** (full UI, address management, user management, activity monitor, logs)
- Courtesy NWC Proxy service (new container)
- Playwright multi-browser E2E (from this month onward)

### Month 4: User Dashboard + Wallet Completion
- **User Dashboard** (profile, npub/NIP-05 setup, address config, redirect management, NWC connection, preferences)
- Frontend wallet redesign completion
- White-label customization
- Customizable landing page
- E2E continued

---

## Phase 3: Expansion (Months 5–6)

### Month 5: Lightning Compliance + NWC Listener
- LUD-16 full compliance (with alias/redirect)
- NIP-57 zaps
- LUD-21 verify endpoint
- LUD-22 webhooks
- NWC Payment Listener service (new container)
- SDK + Hooks update

### Month 6: Docs + Deployment
- API documentation (OpenAPI/Swagger)
- Codebase documentation
- Deployment configs (Vercel, Netlify, Umbrel, Start9, Docker)
- Security preparation

---

## Post-Grant Vision

See [VISION.md](./VISION.md) for the CRM + AI + Nostr communications roadmap (months 7+).

---

## Lightning Address Priority

| Feature | Standard | Month |
|---------|----------|-------|
| Base lightning address | LUD-16 | 5 |
| Zaps | NIP-57 | 5 |
| Verify endpoint | LUD-21 | 5 |
| Webhooks | LUD-22 | 5 |
| Address redirect | — | 5 |
| Address management (admin) | — | 3 |
| User dashboard + npub | — | 4 |
| Courtesy NWC (Alby, LNBits, etc.) | — | 3 |

---

## New Containers Timeline

| Month | Container | Service |
|-------|-----------|---------|
| 3 | `lawallet-nwc-proxy` | Courtesy NWC Proxy |
| 5 | `lawallet-listener` | NWC Payment Listener |
