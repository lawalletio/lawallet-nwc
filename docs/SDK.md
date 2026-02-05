# Client SDK + React Hooks

## Overview

Two packages provide typed access to the LaWallet NWC backend:

- **Client SDK** — standalone TypeScript client for all API endpoints
- **React Hooks** — React hooks built on top of the SDK with caching and state management

---

## TypeScript Client SDK

### Package

- Published as standalone npm package
- Auto-generated TypeScript types from API schemas
- Unit tests with MSW mocks

### API Coverage

- **Lightning Address**: create, lookup, update, delete
- **Alias/Redirect**: set target, remove, get status
- **NWC Connection**: connect, disconnect, status
- **Authentication**: JWT login, Nostr login, refresh, revoke
- **Webhooks**: subscribe, unsubscribe, list
- **Wallet**: balance, send, receive

### Delivered

- Month 2: Core SDK (auth, addresses, redirect, NWC, webhooks)
- Month 3: Courtesy NWC methods
- Month 5: LUD-21/22, redirect, zap methods
- Month 6: Full documentation + API reference

---

## React Hooks Package

### Package

- Published as `@lawallet-nwc/react`
- Built on top of Client SDK
- SWR or React Query for caching + revalidation
- Loading, error, and success states on every hook
- TypeScript generics for type-safe responses

### Hooks Reference

| Hook | Purpose | Month |
|------|---------|-------|
| `useAddress` | CRUD single lightning address (including redirect config) | 2 |
| `useAddresses` | List/search/filter with pagination | 2 |
| `useNWCConnection` | Connect, disconnect, status polling | 2 |
| `usePayments` | Payment history, real-time updates | 2 |
| `useAuth` | JWT + Nostr login, session state, logout | 2 |
| `useWebhooks` | Subscribe, unsubscribe, list active hooks | 2 |
| `useWallet` | Balance, send, receive, NWC status | 2 |
| `useCourtesyNWC` | Provision/revoke courtesy NWC from proxy | 3 |
| `useZap` | Send/receive zaps, verify receipts | 5 |
| `useVerify` | Payment settlement status (LUD-21) | 5 |
| `useRedirect` | Address alias/redirect configuration | 5 |

---

## Lifecycle

| Month | SDK Milestone | Hooks Milestone |
|-------|---------------|-----------------|
| 2 | Core: auth, addresses, redirect, NWC, webhooks. npm publish. | 7 base hooks. Published as @lawallet-nwc/react. |
| 3 | Frontend + Courtesy NWC Proxy consume SDK. | Add `useCourtesyNWC`. |
| 5 | Add LUD-21/22, redirect, zap methods. | Add `useZap`, `useVerify`, `useRedirect`. Update `useWebhooks`. |
| 6 | Full docs + API reference. | Full docs + usage examples. |
