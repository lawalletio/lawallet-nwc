# Month 3: Admin Dashboard Enhancement + Nostr Login + E2E

**Period:** March 5 - April 5, 2026
**Status:** Planned
**Depends on:** Month 2 (SDK + Hooks)

## Summary

The admin dashboard already has a functional base (cards, designs, addresses, settings) and backend auth (JWT + RBAC) was completed in Month 1. This month focuses on enhancing the admin UI with richer features, adding browser-based Nostr login, starting the frontend cleanup, and introducing E2E testing.

---

## Goals

- Enhance the Admin Dashboard with full management capabilities
- Implement NIP-07/NIP-46 Nostr browser login
- Begin frontend component cleanup and standardization
- Set up Playwright multi-browser E2E testing

---

## Admin Dashboard Enhancement (Primary Focus)

### What Already Exists

- Dashboard overview with stat cards (total cards, designs, addresses, active cards)
- Cards page with search, table, and action dropdown
- Designs page with grid layout and search
- Addresses page with stats and list view
- Settings page with tabs (General, Community, Alby, Remote Connections)
- Sidebar navigation and admin wrapper

### New: User Management Section

- User list with search and filter by role
- View and edit user details
- Change user roles (using existing `PUT /api/users/[userId]/role`)
- View user onboarding stage (redirect / courtesy / NWC / self-hosted)
- Block and unblock accounts

### New: Activity Monitor

- Real-time transaction feed
- Filter by address, user, status, date
- Payment success and failure tracking

### New: Logs Panel

- Paginated log viewer consuming Pino output
- Filter by log level, source, timestamp
- Error tracking summary

### Enhancements to Existing Pages

- Address management: create wizard, configure redirects, bulk operations
- Card management: improved pairing flow, batch operations
- Dashboard: richer metrics (redirect vs NWC ratio, recent payments)
- Consume React Hooks (from Month 2) for all data fetching

---

## Nostr Browser Login

### NIP-07: Browser Extension Login

- Detect Nostr extensions (Alby, nos2x, etc.)
- Sign NIP-98 auth events via `window.nostr.signEvent()`
- Login flow: detect extension → request pubkey → `jwtClient.setSigner(signer)` → `jwtClient.login()`

### NIP-46: Remote Signing (Bunker Protocol)

- Connect to Nostr bunker via connection string
- Remote signing for users without browser extensions
- Fallback for mobile and extension-less browsers

### Session Management (Backend Implemented)

- NIP-98 login → JWT session flow (`POST /api/jwt` with Nostr auth)
- JWT tokens contain `pubkey`, `role`, `permissions` claims
- Automatic token refresh via NIP-98 re-authentication (`jwtClient.refreshToken()`)
- Unified auth middleware accepts both `Nostr` and `Bearer` authorization headers
- Unified login modal with method selection

---

## Frontend Cleanup

- Component audit: identify unused, duplicated, and oversized components
- Standardize prop interfaces across shadcn/ui wrappers
- Extract shared utilities to `/lib`
- Add error boundaries to key sections
- Begin consuming SDK hooks for data fetching (replacing direct API calls)

---

## E2E Testing (Playwright)

- Multi-browser smoke tests: Chrome, Firefox, Safari
- Admin dashboard flow coverage: login, navigation, CRUD operations
- Wallet login flow coverage
- Visual regression baseline on current UI
- CI integration via GitHub Actions

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| User management | User list, role editing, search/filter working | P0 |
| Activity monitor | Transaction feed with filters | P1 |
| Logs panel | Log viewer with level filtering | P1 |
| NIP-07 login | Browser extension login working | P0 |
| NIP-46 login | Remote signing login working | P1 |
| Address enhancements | Create wizard, redirects, bulk ops | P0 |
| Frontend cleanup | Component audit complete, hooks consumed | P1 |
| E2E setup | Playwright running in CI, smoke tests passing | P1 |
