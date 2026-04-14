# Architecture

## Overview

LaWallet NWC is composed of **three fully independent, containerized services**. Each runs in its own Docker container with its own database/storage. There is no shared infrastructure between services. They communicate exclusively via HTTP APIs and WebSocket events.

The monorepo uses pnpm workspaces + Turborepo. Node v22.14.0 (see `.nvmrc`).

```
lawallet-nwc/
├── apps/
│   ├── web/           Next.js 16 — frontend, REST API, LUD-16 resolution
│   ├── docs/          Fumadocs + Next.js — documentation site
│   ├── proxy/         NWC Proxy — provisions courtesy NWC connections (stub)
│   └── listener/      NWC Listener — monitors relays, dispatches webhooks (stub)
├── packages/
│   ├── sdk/           TypeScript SDK client (stub)
│   └── shared/        Shared types & utilities (stub)
├── docker-compose.yml PostgreSQL + web service
├── turbo.json         Build pipeline configuration
└── pnpm-workspace.yaml
```

---

## Service Topology

| Container | Service | Ports | Storage |
|-----------|---------|-------|---------|
| `lawallet-web` | Next.js Application | 3000 (dev), 2288 (prod) | Own PostgreSQL (Prisma) |
| `lawallet-listener` | NWC Payment Listener | 3001 (WS), 3002 (health) | Own storage |
| `lawallet-nwc-proxy` | Courtesy NWC Proxy | 3003, 3004 (health) | Own storage |

---

## Independence Principles

- No shared database between any services
- No shared file system or volumes
- Communication strictly via HTTP APIs and WebSocket events
- Each service can be deployed, scaled, and updated independently
- Each service has its own health check endpoint
- Each service manages its own configuration via environment variables
- Any service can be replaced or restarted without affecting others

---

## lawallet-web (Next.js Application)

The main application serving frontend, API, and lightning address resolution.

- App Router (Next.js 16) serving frontend and API routes
- Frontend consumes React Hooks for all data operations
- LUD-16 lightning address resolution via `/api/lud16/[username]`
- NIP-05 identity verification via `/api/lightning-addresses/relays`
- Alias/redirect resolution: proxies LNURL-pay to target address when user has no NWC
- Admin dashboard for platform management
- Own PostgreSQL database via Prisma ORM

See: [services/LAWALLET-WEB.md](./services/LAWALLET-WEB.md)

---

## lawallet-listener (NWC Payment Listener)

Standalone microservice monitoring NWC relays for incoming payments.

- Long-running Node.js process
- Subscribes to NWC relays for NIP-47 `payment_received` events
- Matches incoming payments to registered lightning addresses
- Dispatches LUD-22 webhooks with HMAC-signed payloads
- Emits real-time events via WebSocket to the Next.js app
- Exponential backoff retry (3 attempts) for webhook delivery
- Dead letter queue for permanently failed deliveries
- Own storage for event logs and delivery tracking
- No dependency on Next.js app database or Courtesy NWC Proxy

See: [services/NWC-LISTENER.md](./services/NWC-LISTENER.md)

---

## lawallet-nwc-proxy (Courtesy NWC Proxy)

Lightweight service provisioning temporary NWC connections from external providers.

- Stateless proxy: does not hold funds, only provisions connection strings
- Provider-agnostic: unified API abstracting Alby Hub, LNBits, BTCPayServer, YakiHonne, generic NWC
- Own container, own storage for connection tracking
- No access to other services' databases

See: [services/NWC-PROXY.md](./services/NWC-PROXY.md)

---

## Module Boundaries (lawallet-web)

The web application is organized into clearly separated modules:

| Module | Path | Responsibility |
|--------|------|---------------|
| **API Routes** | `app/api/` | 30 route handlers, REST endpoints |
| **Auth** | `lib/auth/` | Unified auth, RBAC, role resolution |
| **NIP-98** | `lib/nip98.ts` | Nostr HTTP Auth event validation |
| **JWT** | `lib/jwt.ts` | Token creation, verification, refresh |
| **Middleware** | `lib/middleware/` | Rate limiting, request limits, maintenance |
| **Validation** | `lib/validation/` | Zod schemas, request validation |
| **Config** | `lib/config/` | Environment validation, cached config |
| **Database** | `lib/prisma.ts` + `prisma/` | Prisma client, schema, migrations |
| **NTAG424** | `lib/ntag424.ts` | NFC card crypto, signature validation |
| **Alby Hub** | `lib/albyhub.ts` | Alby API client for NWC provisioning |
| **Logger** | `lib/logger.ts` | Pino structured logging, request IDs |
| **Errors** | `types/server/` | Error hierarchy, error handler HOF |
| **Client Hooks** | `lib/client/hooks/` | React hooks for API consumption |
| **Client Auth** | `lib/client/` | Nostr signers, JWT exchange, API client |
| **UI Components** | `components/` | shadcn/ui components, admin dashboard |

### Module Dependencies

```
┌─────────────────────────────────────────────────────┐
│                   API Routes (app/api/)              │
│  cards, users, settings, jwt, lud16, admin, ...     │
└────────────────────────┬────────────────────────────┘
                         │ uses
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│  Middleware   │ │    Auth      │ │   Validation     │
│ rate-limit   │ │ unified-auth │ │ Zod schemas      │
│ req-limits   │ │ permissions  │ │ body/query/params │
│ maintenance  │ │ resolve-role │ │                  │
└──────┬───────┘ └──────┬───────┘ └──────────────────┘
       │                │
       │         ┌──────┴──────┐
       │         ▼             ▼
       │  ┌──────────┐  ┌──────────┐
       │  │  NIP-98  │  │   JWT    │
       │  └──────────┘  └──────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│              Core Services               │
│  prisma (DB)  │  albyhub  │  ntag424    │
│  logger       │  config   │  settings   │
└──────────────────────────────────────────┘
```

---

## Authentication Flow

LaWallet NWC supports two authentication methods. Both resolve to the same `AuthResult { pubkey, role, method }`.

### NIP-98 (Nostr HTTP Auth)

```
Client                              Server
  │                                    │
  │  Signs NIP-98 event (kind 27235)   │
  │  targeting the request URL         │
  │                                    │
  │  Authorization: Nostr <base64>     │
  │───────────────────────────────────▶│
  │                                    │
  │                            Validate event:
  │                            - Signature (nostr-tools)
  │                            - Timestamp (±60s window)
  │                            - URL match (u tag)
  │                            - Method match (method tag)
  │                            - Payload hash (payload tag)
  │                                    │
  │                            Resolve role:
  │                            - Query User by pubkey
  │                            - Fallback: check Settings.root
  │                            - Default: Role.USER
  │                                    │
  │            AuthResult              │
  │◀───────────────────────────────────│
```

**File:** `lib/nip98.ts`

### JWT (Bearer Token)

```
Client                              Server
  │                                    │
  │  Step 1: Exchange NIP-98 for JWT   │
  │  POST /api/jwt                     │
  │  Authorization: Nostr <base64>     │
  │───────────────────────────────────▶│
  │                                    │
  │  { token, expiresIn, type }        │
  │◀───────────────────────────────────│
  │                                    │
  │  Step 2: Use JWT for requests      │
  │  Authorization: Bearer <token>     │
  │───────────────────────────────────▶│
  │                                    │
  │                            Verify JWT:
  │                            - HS256 signature
  │                            - Expiration
  │                            - Issuer / audience
  │                            - Extract: userId, pubkey,
  │                              role, permissions
  │                                    │
  │            AuthResult              │
  │◀───────────────────────────────────│
```

**File:** `lib/jwt.ts`

### Unified Auth Detection

The `authenticate()` function in `lib/auth/unified-auth.ts` detects the method from the `Authorization` header prefix:

| Header Prefix | Method | Handler |
|---------------|--------|---------|
| `Nostr <base64>` | NIP-98 | `validateNip98Token()` |
| `Bearer <token>` | JWT | `verifyJwtToken()` |
| Missing/other | — | `AuthenticationError` |

Higher-level wrappers:
- `authenticateWithRole(request, requiredRole)` — enforces role hierarchy
- `authenticateWithPermission(request, permission)` — enforces granular permission
- `withAuth(handler, { role?, permission? })` — HOF for route handlers

---

## Authorization Flow (RBAC)

### Role Hierarchy

```
ADMIN > OPERATOR > VIEWER > USER
```

Roles are compared by hierarchy position. A user with `OPERATOR` role satisfies any check requiring `VIEWER` or `USER`.

### Permission Matrix

| Permission | ADMIN | OPERATOR | VIEWER | USER |
|-----------|:-----:|:--------:|:------:|:----:|
| `settings:read` | ✓ | | ✓ | |
| `settings:write` | ✓ | | | |
| `users:read` | ✓ | ✓ | ✓ | |
| `users:write` | ✓ | | | |
| `users:manage_roles` | ✓ | | | |
| `cards:read` | ✓ | ✓ | ✓ | |
| `cards:write` | ✓ | ✓ | | |
| `card_designs:read` | ✓ | ✓ | ✓ | |
| `card_designs:write` | ✓ | ✓ | | |
| `addresses:read` | ✓ | ✓ | ✓ | |
| `addresses:write` | ✓ | ✓ | | |
| `ntags:read` | ✓ | ✓ | ✓ | |
| `ntags:write` | ✓ | ✓ | | |

**File:** `lib/auth/permissions.ts`

### Role Resolution

1. Query `User` table by pubkey → return `user.role`
2. Fallback: check `Settings` table for `root` key → if pubkey matches, return `ADMIN`
3. Default: `Role.USER`

**File:** `lib/auth/resolve-role.ts`

---

## Middleware Pipeline

Every API route handler is wrapped with `withErrorHandling()`. Additional middleware is applied per-route as needed.

### Execution Order

```
Request
  │
  ▼
withErrorHandling()          ← Catches all errors, returns structured JSON
  │
  ▼
withRequestLogging()         ← Logs request start/end/duration (optional)
  │
  ▼
checkMaintenance()           ← Returns 503 if maintenance mode (admins bypass)
  │
  ▼
checkRateLimit()             ← In-memory rate limiter per IP
  │
  ▼
validateBody/Query/Params()  ← Zod schema validation
  │
  ▼
authenticate()               ← NIP-98 or JWT auth (if required)
  │
  ▼
Route Handler                ← Business logic
  │
  ▼
Response (JSON)
```

### Rate Limiting

In-memory store with periodic cleanup. Limits are per-IP (extracted from `x-forwarded-for`, `x-real-ip`, or `cf-connecting-ip` headers).

| Preset | Requests/Window | Window |
|--------|:---------------:|:------:|
| `public` | 60 | 1 min |
| `auth` | 10 | 1 min |
| `sensitive` | 5 | 1 min |
| `cardScan` | 200 | 1 min |
| `lud16` | 120 | 1 min |

Authenticated users get separate (typically higher) limits.

**File:** `lib/middleware/rate-limit.ts`

### Request Limits

Validates body size before parsing.

| Preset | Max Body | Notes |
|--------|:--------:|-------|
| `json` | 100 KB | Default for API routes |
| `large` | 1 MB | File metadata, bulk ops |
| `upload` | Configurable | File count + size limits |

**File:** `lib/middleware/request-limits.ts`

### Maintenance Mode

Enabled via `MAINTENANCE_MODE=true` environment variable. Returns `503 Service Unavailable` for all requests except those authenticated as `ADMIN` via NIP-98.

**File:** `lib/middleware/maintenance.ts`

---

## Error Handling

All errors extend the base `ApiError` class and are caught by `withErrorHandling()`.

### Error Hierarchy

```
ApiError (base)
├── ValidationError          400
├── AuthenticationError      401
├── AuthorizationError       403
├── NotFoundError            404
├── ConflictError            409
├── PayloadTooLargeError     413
├── TooManyRequestsError     429
└── ServiceUnavailableError  503
```

Each error includes: `statusCode`, `code` (machine-readable string), `message`, optional `details`, and optional `cause`.

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": { "field": "username", "issue": "Required" }
  }
}
```

Unexpected errors (not `ApiError` instances) return `500` with a generic message. Full stack traces are logged server-side via Pino but never exposed to clients.

**Files:** `types/server/errors.ts`, `types/server/error-handler.ts`

---

## Database Schema

PostgreSQL via Prisma ORM. 7 models + 1 enum.

### Entity Relationship Diagram

```
┌──────────┐     1:N     ┌────────────┐
│   User   │────────────▶│ CardDesign │
│          │             └─────┬──────┘
│ id (PK)  │                   │ 1:N
│ pubkey ◄─┤             ┌─────▼──────┐
│ role     │     1:N     │    Card    │
│ nwc      │────────────▶│            │
│          │             │ ntag424Cid ├──────1:1──────┐
│          │             └────────────┘               │
│          │                                    ┌─────▼──────┐
│          │     1:N                            │  Ntag424   │
│          │───────────────────────────────────▶│            │
│          │                                    │ cid (PK)   │
│          │     1:1     ┌──────────────────┐   │ k0–k4      │
│          │────────────▶│ LightningAddress │   │ ctr        │
│          │             │ username (PK)    │   └────────────┘
│          │             └──────────────────┘
│          │     1:1     ┌──────────────────┐
│          │────────────▶│ AlbySubAccount   │
└──────────┘             │ appId (PK)       │
                         └──────────────────┘

┌──────────┐
│ Settings │  (standalone key-value store)
│ name (PK)│
│ value    │
└──────────┘
```

### Models

| Model | Primary Key | Purpose |
|-------|-------------|---------|
| **User** | `id` (UUID) | Identity, auth, role assignment. `pubkey` is unique. |
| **CardDesign** | `id` (UUID) | NFC card visual templates. Optional owner via `userId`. |
| **Card** | `id` (UUID) | NFC card instances. Links to a design and optionally an NTAG424 chip. |
| **Ntag424** | `cid` (chip ID) | NTAG424 cryptographic keys (k0–k4) and monotonic counter. |
| **LightningAddress** | `username` | Maps a username to a user. One address per user. |
| **AlbySubAccount** | `appId` (int) | Alby NWC provisioning data. One per user. |
| **Settings** | `name` | Key-value store for platform configuration (domain, root pubkey, etc.) |

**File:** `apps/web/prisma/schema.prisma`

---

## Configuration Management

### Environment Variables (Zod-validated)

All environment variables are validated at startup via Zod schema in `lib/config/env.ts`. Invalid config crashes the process immediately.

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_SECRET` | | 32+ char secret for HS256 signing |
| `ALBY_API_URL` | | Alby Hub endpoint |
| `ALBY_BEARER_TOKEN` | | Alby API authentication |
| `AUTO_GENERATE_ALBY_SUBACCOUNTS` | | Auto-provision wallets on signup |
| `MAINTENANCE_MODE` | | Enable 503 for non-admins |
| `LOG_LEVEL` | | Pino log level (default: `info`) |
| `LOG_PRETTY` | | Human-readable logs (dev) |
| `RATE_LIMIT_WINDOW_MS` | | Rate limit window (default: 60000) |
| `RATE_LIMIT_MAX_REQUESTS` | | Max requests per window |
| `RATE_LIMIT_MAX_AUTHENTICATED` | | Max for authenticated users |
| `REQUEST_MAX_BODY_SIZE` | | Max body in bytes |

### Cached Config Object

`lib/config/index.ts` exports `getConfig()` which returns a cached `AppConfig` object with structured access:

```typescript
const config = getConfig()
config.jwt.secret       // JWT_SECRET
config.alby.apiUrl      // ALBY_API_URL
config.server.port      // PORT
config.rateLimit.window // RATE_LIMIT_WINDOW_MS
config.maintenance.enabled // MAINTENANCE_MODE
```

Config is validated once at startup and cached for the process lifetime. Use `resetConfig()` in tests to clear the cache.

---

## External Integrations

### Alby Hub

HTTP client for provisioning NWC subaccounts and lightning addresses.

| Method | Purpose |
|--------|---------|
| `createSubAccount(name)` | Provisions isolated NWC subaccount |
| `createLightningAddress(username, appId)` | Maps address to Alby app |

When `AUTO_GENERATE_ALBY_SUBACCOUNTS=true`, new users automatically get a courtesy NWC wallet via Alby on signup.

**File:** `lib/albyhub.ts`

### Lightning Network (via NWC)

Uses `@getalby/sdk` for payment operations. The `LN` class accepts a NWC connection string and exposes:

- `requestPayment(sats, description)` — Generate a Lightning invoice

Used by LUD-16 callback and card scan endpoints.

### Nostr Relays

- NIP-98 events validated via `nostr-tools`
- NIP-05 identity served from the addresses table
- NIP-47 (NWC) used for wallet communication

---

## NTAG424 (BoltCard) System

NFC cards use NTAG424 DNA chips with SUN (Secure Unique NFC) authentication.

### Card Provisioning

1. Generate 5 random 16-byte AES keys (k0–k4) per chip
2. Write LNURL-withdraw URL to chip NFC data
3. Store keys + chip ID in database

### Card Tap Verification

```
NFC Tap
  │
  │  lnurlw://.../api/cards/{id}/scan?p=<encrypted>&c=<mac>
  │
  ▼
GET /api/cards/{id}/scan
  │
  ├── Decrypt `p` with k1 → extract chip ID + counter
  ├── Calculate SDMMAC(k2, cid, ctr) → verify against `c`
  ├── Check counter monotonicity (replay protection)
  ├── Return LUD-03 withdraw request
  │
  ▼
GET /api/cards/{id}/scan/cb?amount=...
  │
  ├── Re-validate NTAG424 signature
  ├── Update Card.lastUsedAt + Ntag424.ctr
  ├── Request invoice via user's NWC
  └── Return Lightning invoice
```

**File:** `lib/ntag424.ts`

---

## Data Flows

### Lightning Address Resolution (LUD-16)

```
Sender Wallet                        lawallet-web
     │                                    │
     │  GET /api/lud16/alice              │
     │───────────────────────────────────▶│
     │                                    │
     │                            Lookup LightningAddress
     │                            Verify User.nwc exists
     │                                    │
     │  { tag: "payRequest",              │
     │    callback: ".../lud16/alice/cb", │
     │    minSendable, maxSendable,       │
     │    metadata }                      │
     │◀───────────────────────────────────│
     │                                    │
     │  GET /api/lud16/alice/cb?amount=X  │
     │───────────────────────────────────▶│
     │                                    │
     │                            LN(user.nwc)
     │                              .requestPayment(sats)
     │                                    │
     │  { pr: <invoice>, routes: [] }     │
     │◀───────────────────────────────────│
```

### Incoming Payment (NWC User)

1. Sender resolves `alice@domain.com` via LUD-16
2. Platform returns LNURL-pay callback pointing to alice's NWC wallet
3. Payment routed to NWC wallet
4. **lawallet-listener** detects `payment_received` on NWC relay
5. Listener records event in own storage
6. Listener dispatches LUD-22 webhooks (HMAC-signed)
7. Listener emits WebSocket event to **lawallet-web** for real-time display

### Incoming Payment (Alias/Redirect User)

1. Sender resolves `alice@domain.com` via LUD-16
2. Platform detects alice has a redirect target (e.g., `alice@walletofsatoshi.com`)
3. Platform proxies LNURL-pay request to redirect target
4. Payment goes directly to alice's existing wallet
5. No NWC listener involvement

### Address Resolution Priority

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | Own NWC Connection | User connected their own NWC wallet |
| 2 | Courtesy NWC | Temporary connection via Courtesy NWC Proxy |
| 3 | Alias / Redirect | Redirects to external lightning address |

### JWT Exchange Flow

1. Client signs NIP-98 event (kind 27235) targeting `POST /api/jwt`
2. `POST /api/jwt` with `Authorization: Nostr <base64>` header
3. Server validates NIP-98, resolves user role, creates JWT with `{ userId, pubkey, role, permissions }`
4. Returns `{ token, expiresIn, type: "Bearer" }`
5. Subsequent requests use `Authorization: Bearer <token>`
6. Client auto-refreshes token 5 minutes before expiry

### User Onboarding Flow

1. Client authenticates via NIP-98 or JWT
2. `GET /api/users/me` → creates User record if new (auto-generated UUID)
3. If `AUTO_GENERATE_ALBY_SUBACCOUNTS=true`:
   - `AlbyHub.createSubAccount()` → get NWC URI
   - Store in `AlbySubAccount` model, set on User
4. User gets a lightning address, then upgrades through the progressive self-custody model

See: [ONBOARDING.md](./ONBOARDING.md)

---

## Real-Time Updates (SSE)

Server-Sent Events provide real-time push notifications to the admin dashboard. The architecture uses a notification-only pattern: SSE events signal that data changed, and the client refetches via existing API endpoints.

### Event Bus

In-memory singleton (`lib/events/event-bus.ts`) using the same `globalThis` pattern as Prisma. Mutation API routes call `eventBus.emit()` after successful database writes.

### SSE Endpoint

`GET /api/events?token=<jwt>` — Long-lived streaming connection.

1. Validates JWT from query parameter (EventSource API doesn't support headers)
2. Resolves permissions from the JWT role claim
3. Streams events filtered by permission
4. Sends heartbeat every 30 seconds
5. Cleans up on disconnect

### Event Types

| Event | Permission Required | Triggered By |
|-------|-------------------|-------------|
| `addresses:updated` | `ADDRESSES_READ` | Lightning address create/update |
| `cards:updated` | `CARDS_READ` | Card create/activate |
| `designs:updated` | `CARD_DESIGNS_READ` | Design import |
| `settings:updated` | `SETTINGS_READ` | Settings update |
| `invoices:updated` | Any authenticated | Invoice create/claim |
| `users:updated` | `USERS_READ` | User role change |

### Client Integration

The `SSEProvider` (in `app/providers.tsx`) manages the EventSource connection and exposes version counters per event type. The `useApi()` hook maps API paths to event types and includes the SSE version in its effect dependencies — when a version bumps, the hook refetches automatically. This is transparent to all consumers (`useAddresses()`, `useCards()`, etc.).

```
SSEProvider (connects on auth, reconnects with backoff)
  → increments version counter per event type
  → useApi(path) observes version via useSSEVersion()
  → version bump triggers refetch
```

**Files:** `lib/events/event-bus.ts`, `app/api/events/route.ts`, `lib/client/hooks/use-sse.ts`

---

## Logging

Pino-based structured logging with AsyncLocalStorage for request ID correlation.

- Every request gets a unique `reqId` injected into all log entries
- `withRequestLogging()` HOF tracks request duration, logs start/end/error
- Pretty mode for development, JSON for production
- Error serializers include stack traces (server-side only)
- Configurable via `LOG_LEVEL` and `LOG_PRETTY` env vars

**File:** `lib/logger.ts`

---

## API Route Reference

### Admin

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/admin/assign` | NIP-98 | Assign root admin role |
| GET | `/api/admin/assign` | NIP-98 | Check if pubkey is root |

### JWT

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/jwt` | NIP-98 | Exchange NIP-98 for JWT |
| GET | `/api/jwt` | Bearer | Validate JWT, return claims |
| GET | `/api/jwt/protected` | Bearer | Test protected endpoint |

### Cards

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/cards` | ADMIN | List all cards (filter: paired, used) |
| POST | `/api/cards` | Auth | Create card with NTAG424 + OTC |
| GET | `/api/cards/[id]` | Auth | Get card details |
| GET | `/api/cards/counts` | Auth | Count paired/unpaired/used |
| GET | `/api/cards/[id]/scan` | Public | LUD-03 withdraw request (NFC tap) |
| GET | `/api/cards/[id]/scan/cb` | Public | LUD-03 callback, issue invoice |
| POST | `/api/cards/[id]/write` | Auth | Prepare NFC write payload |
| GET | `/api/cards/otc/[otc]` | Public | Lookup card by one-time code |
| POST | `/api/cards/otc/[otc]/activate` | Auth | Activate card with username |

### Card Designs

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/card-designs/list` | Auth | List all designs |
| POST | `/api/card-designs/import` | Auth | Import design from image URL |
| GET | `/api/card-designs/count` | Auth | Design count |
| GET | `/api/card-designs/get/[id]` | Auth | Get design by ID |

### Lightning Addresses

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/lightning-addresses` | Auth | List user addresses |
| POST | `/api/lightning-addresses` | Auth | Create new address |
| GET | `/api/lightning-addresses/check` | Auth | Check username availability |
| GET | `/api/lightning-addresses/counts` | Auth | Address statistics |
| GET | `/api/lightning-addresses/relays` | Public | NIP-05 relay list |

### LUD-16

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/lud16/[username]` | Public | LUD-16 pay metadata |
| GET | `/api/lud16/[username]/cb` | Public | LUD-16 callback, issue invoice |

### Users

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | Auth | Current user (auto-creates) |
| GET | `/api/users/[userId]/cards` | Auth | List user's cards |
| POST | `/api/users/[userId]/lightning-address` | Auth | Create address for user |
| GET | `/api/users/[userId]/lightning-address` | Auth | Get user's address |
| POST | `/api/users/[userId]/nwc` | Auth | Update NWC URI |
| GET | `/api/users/[userId]/nwc` | Auth | Get user's NWC |
| POST | `/api/users/[userId]/role` | Permission | Update user role |

### Settings

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/settings` | SETTINGS_READ | Fetch settings by keys |
| POST | `/api/settings` | SETTINGS_WRITE | Update settings |

### Remote Connections

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/remote-connections/[key]` | Auth | Get remote device info |
| POST | `/api/remote-connections/[key]/cards` | Auth | Remote card creation |

### Events (SSE)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/events?token=<jwt>` | JWT (query) | SSE stream for real-time updates |

---

## Deployment Options

| Platform | Containers | Notes |
|----------|------------|-------|
| Vercel | web only | Listener + Proxy deployed separately |
| Netlify | web only | Same as Vercel |
| Umbrel | All 3 | Full app store package |
| Start9 | All 3 | Embassy package |
| Docker Compose | All 3 | Independent containers + reverse proxy |

See: [DOCKER.md](./DOCKER.md)

---

## Open Standards

| Protocol | Usage |
|----------|-------|
| NIP-47 (NWC) | Wallet Connect — payment backend |
| NIP-98 | HTTP Auth with Nostr events |
| NIP-05 | Nostr identity verification |
| NIP-07 / NIP-46 | Browser extension and remote signing |
| NIP-57 | Nostr zaps |
| LUD-16 | Lightning Address (LNURL-pay) |
| LUD-03 | LNURL-withdraw (card taps) |
| LUD-21 | Payment verification |
| LUD-22 | Webhooks |
| BoltCard / NTAG424 | NFC tap-to-pay cards |

---

## Related Documentation

- [VISION.md](./VISION.md) — Project vision and principles
- [ONBOARDING.md](./ONBOARDING.md) — Progressive self-custody model
- [TESTING.md](./TESTING.md) — Testing strategy and coverage targets
- [DOCKER.md](./DOCKER.md) — Docker build and deployment
- [JWT_USAGE.md](./JWT_USAGE.md) — JWT implementation details
- [SDK.md](./SDK.md) — Client SDK documentation
- [ROADMAP.md](./ROADMAP.md) — Development timeline
- [services/LAWALLET-WEB.md](./services/LAWALLET-WEB.md) — Web service details
- [services/NWC-LISTENER.md](./services/NWC-LISTENER.md) — Listener service details
- [services/NWC-PROXY.md](./services/NWC-PROXY.md) — Proxy service details
