# JWT Authentication System

This document explains the authentication system in the Lawallet NWC application, which combines NIP-98 (Nostr HTTP Auth) with JWT session tokens.

## Overview

The authentication system uses a **NIP-98 Login -> JWT Session** approach:

1. **Login**: The client signs a NIP-98 event (Nostr kind 27235) and sends it to `POST /api/jwt`
2. **Session**: The server validates the Nostr signature, resolves the user's role, and returns a JWT with `pubkey`, `role`, and `permissions` baked in
3. **Requests**: Subsequent API requests use the JWT via `Authorization: Bearer <token>`, avoiding repeated Nostr signatures
4. **Dual Auth**: Routes accept both `Nostr` and `Bearer` authorization headers through a unified auth middleware

### Architecture

```
Client                              Server
  |                                   |
  |-- NIP-98 signed event ----------->|  POST /api/jwt
  |                                   |  validateNip98() -> resolveRole()
  |<----------- JWT token ------------|  createJwtToken({ pubkey, role, permissions })
  |                                   |
  |-- Bearer <jwt> ------------------>|  GET /api/some-route
  |                                   |  authenticate() -> reads role from JWT claims
  |<----------- response -------------|
```

### Key Components

- **Server-side JWT library** (`lib/jwt.ts`) - Core JWT functions (unchanged)
- **Unified auth middleware** (`lib/auth/unified-auth.ts`) - Accepts both Nostr and Bearer auth
- **Authentication middleware** (`lib/jwt-auth.ts`) - JWT-only route protection (for `/api/jwt/protected`)
- **Client-side utilities** (`lib/jwt-client.ts`) - NIP-98 login flow + token management
- **Role resolution** (`lib/auth/resolve-role.ts`) - DB lookup + root pubkey fallback
- **Permissions** (`lib/auth/permissions.ts`) - RBAC model: USER < VIEWER < OPERATOR < ADMIN
- **API endpoints** (`/api/jwt`, `/api/jwt/protected`) - Token creation and validation

## Setup

### 1. Environment Variables

Add the following to your `.env.local` file:

```bash
JWT_SECRET=your-super-secret-jwt-key-here
```

**Important**: Use a strong, random secret key (at least 32 characters) in production.

### 2. Dependencies

The required packages are already installed:

- `jsonwebtoken` - JWT creation and verification
- `@types/jsonwebtoken` - TypeScript types
- `@nostrify/nostrify` - Nostr signer interface for NIP-98

## Authentication Flow

### How It Works

1. **Client** creates a NIP-98 event (kind 27235) signed with the user's Nostr key
2. **Client** sends `Authorization: Nostr <base64-encoded-event>` to `POST /api/jwt`
3. **Server** validates the NIP-98 event (signature, timestamp within 60s, URL/method binding)
4. **Server** resolves the user's role from the database (or root pubkey from settings)
5. **Server** creates a JWT with `pubkey`, `role`, and `permissions` in the claims
6. **Client** stores the JWT and uses `Authorization: Bearer <jwt>` for subsequent requests
7. **Server** routes use unified auth middleware that accepts either scheme

### JWT Claims

The JWT token contains:

| Claim | Description | Example |
|-------|-------------|---------|
| `sub` / `userId` | User's Nostr pubkey (hex) | `"ab12...ef"` |
| `pubkey` | Same as sub, explicit claim | `"ab12...ef"` |
| `role` | User's RBAC role | `"ADMIN"` |
| `permissions` | Role's permission set | `["manage_users", "manage_cards", ...]` |
| `iss` | Token issuer | `"lawallet-nwc"` |
| `aud` | Token audience | `"lawallet-users"` |
| `exp` | Expiration timestamp | `1706832000` |
| `iat` | Issued-at timestamp | `1706828400` |

## Server-Side Usage

### Unified Auth Middleware (Recommended)

The unified auth middleware automatically detects the authorization scheme:

```typescript
import { authenticate, authenticateWithRole, authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'

// Basic authentication (accepts Nostr or Bearer)
export async function GET(request: Request) {
  const { pubkey, role, method } = await authenticate(request)
  // method is 'nip98' or 'jwt'
  return NextResponse.json({ pubkey, role })
}

// Role-based authentication
export async function POST(request: Request) {
  const auth = await authenticateWithRole(request, Role.ADMIN)
  // Throws AuthorizationError if user lacks the required role
  return NextResponse.json({ admin: auth.pubkey })
}

// Permission-based authentication
export async function DELETE(request: Request) {
  const auth = await authenticateWithPermission(request, 'manage_cards')
  return NextResponse.json({ ok: true })
}
```

### Higher-Order Function (withAuth)

```typescript
import { withAuth } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import type { AuthResult } from '@/lib/auth/unified-auth'

async function handler(request: Request, auth: AuthResult) {
  return NextResponse.json({ pubkey: auth.pubkey, role: auth.role })
}

// Basic auth
export const GET = withAuth(handler)

// Require admin role
export const POST = withAuth(handler, { requiredRole: Role.ADMIN })

// Require specific permission
export const DELETE = withAuth(handler, { requiredPermission: 'manage_cards' })

// Force NIP-98 only (rejects Bearer tokens)
export const PUT = withAuth(handler, { requireNip98: true })
```

### JWT-Only Routes

For routes that only accept JWT (like the protected example endpoint):

```typescript
import { withJwtAuth, getUserIdFromRequest } from '@/lib/jwt-auth'
import type { AuthenticatedRequest } from '@/lib/jwt-auth'

async function protectedHandler(request: AuthenticatedRequest) {
  const userId = getUserIdFromRequest(request)
  return NextResponse.json({ message: `Hello ${userId}` })
}

export const GET = withJwtAuth(protectedHandler, {
  requiredClaims: ['role', 'permissions']
})
```

### Creating JWT Tokens (Server-Side)

```typescript
import { createJwtToken } from '@/lib/jwt'

const token = createJwtToken(
  {
    userId: pubkey,
    pubkey,
    role: 'ADMIN',
    permissions: ['manage_users', 'manage_cards']
  },
  process.env.JWT_SECRET!,
  {
    expiresIn: '1h',
    issuer: 'lawallet-nwc',
    audience: 'lawallet-users'
  }
)
```

### Resolving User Roles

```typescript
import { resolveRole } from '@/lib/auth/resolve-role'

const role = await resolveRole(pubkey)
// Returns: 'USER' | 'VIEWER' | 'OPERATOR' | 'ADMIN'
// Checks: 1) User DB record, 2) Root pubkey from settings
```

## Client-Side Usage

### Login with NIP-98

```typescript
import { jwtClient } from '@/lib/jwt-client'

// 1. Set your Nostr signer (NIP-07 extension, NIP-46 bunker, etc.)
jwtClient.setSigner(signer)

// 2. Login - signs a NIP-98 event and exchanges it for a JWT
const tokenData = await jwtClient.login('24h')
// Returns: { token: "eyJ...", expiresIn: "24h", type: "Bearer" }

// Token is automatically stored in localStorage
```

### Making Authenticated Requests

```typescript
import { jwtClient } from '@/lib/jwt-client'

// Authenticated request (auto-refreshes if token is near expiry)
const response = await jwtClient.authenticatedRequest('/api/users/me')

// With custom options
const response = await jwtClient.authenticatedRequest('/api/cards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ designId: 'design_1' })
})
```

### Token Management

```typescript
import { jwtClient } from '@/lib/jwt-client'

// Check if authenticated
if (jwtClient.hasStoredToken()) {
  console.log('User is authenticated')
}

// Get auth header for manual requests
const authHeader = jwtClient.getAuthHeader()
// Returns: "Bearer eyJhbGciOiJIUzI1NiIs..."

// Validate token with server
const isValid = await jwtClient.validateStoredToken()

// Refresh token (re-authenticates with NIP-98)
const newToken = await jwtClient.refreshToken()

// Logout (clears token and signer)
jwtClient.logout()
```

### Auto-Refresh Behavior

When `autoRefresh` is enabled (default) and a signer is set:

- `authenticatedRequest()` checks if the token is within `refreshThreshold` seconds of expiry (default: 300s / 5 minutes)
- If near expiry, it automatically re-authenticates via NIP-98 and stores the new token
- If no signer is set and the token expires, an error is thrown prompting the caller to login again

## API Endpoints

### POST /api/jwt

Authenticate with NIP-98 and receive a JWT session token.

**Headers:**

```
Authorization: Nostr <base64-encoded-kind-27235-event>
Content-Type: application/json
```

**Request Body (optional):**

```json
{
  "expiresIn": "24h"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h",
  "type": "Bearer"
}
```

**Error Responses:**

- `401` - Invalid or missing NIP-98 authentication
- `500` - JWT_SECRET not configured

### GET /api/jwt

Validate an existing JWT token and return its claims.

**Headers:**

```
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "valid": true,
  "pubkey": "ab12cd34ef56...",
  "role": "ADMIN",
  "permissions": ["manage_users", "manage_cards", "manage_settings"],
  "issuedAt": "2026-02-14T00:00:00.000Z",
  "expiresAt": "2026-02-14T01:00:00.000Z"
}
```

### Routes Using Unified Auth

These routes accept both `Nostr` and `Bearer` authorization:

| Route | Method | Auth Level |
|-------|--------|------------|
| `/api/users/me` | GET | Any authenticated user |
| `/api/users/[id]/cards` | GET | Own user only |
| `/api/users/[id]/nwc` | PUT | Own user only |
| `/api/users/[id]/lightning-address` | PUT | Own user only |
| `/api/cards/otc/[otc]/activate` | POST | Any authenticated user |
| `/api/cards` | POST | ADMIN role required |

### Routes Using NIP-98 Only (Admin)

These routes require NIP-98 authentication directly (via `admin-auth.ts`):

| Route | Method | Auth Level |
|-------|--------|------------|
| `/api/admin/root-assign` | POST | Root pubkey only |
| `/api/users/[id]/role` | PUT | ADMIN role |
| `/api/settings` | PUT | ADMIN role |
| `/api/card-designs` | POST/PUT/DELETE | ADMIN role |
| `/api/lightning-addresses` | POST/DELETE | ADMIN role |

## RBAC Model

### Role Hierarchy

```
USER < VIEWER < OPERATOR < ADMIN
```

Each role inherits all permissions from roles below it.

### Permission Matrix

| Permission | USER | VIEWER | OPERATOR | ADMIN |
|------------|------|--------|----------|-------|
| `view_own_data` | x | x | x | x |
| `view_all_data` | | x | x | x |
| `manage_cards` | | | x | x |
| `manage_users` | | | | x |
| `manage_settings` | | | | x |

### Role Resolution

1. Check `User` record in database for explicit role
2. If pubkey matches the `root` setting, return `ADMIN`
3. Default to `USER`

## Security Considerations

1. **JWT Secret**: Use a strong, random secret key (32+ characters) and keep it secure
2. **Token Expiration**: Default is 1 hour; set reasonable expiration times for your use case
3. **HTTPS**: Always use HTTPS in production (NIP-98 validates the full URL)
4. **NIP-98 Window**: Events must be within 60 seconds of current time
5. **Token Storage**: Client stores tokens in localStorage (sufficient for SPA use)
6. **Role Baking**: JWT contains role at issuance time; role changes require new token
7. **Step-Up Auth**: Sensitive admin operations (root assign, role changes) still require NIP-98 directly

## Error Handling

The system provides detailed error messages:

| Error | Status | Cause |
|-------|--------|-------|
| `Authorization header is required` | 401 | Missing auth header |
| `Authorization header must use "Nostr" or "Bearer" scheme` | 401 | Unrecognized auth scheme |
| `Invalid NIP-98 authentication` | 401 | Bad Nostr event signature, expired, etc. |
| `Invalid or expired JWT` | 401 | Malformed or expired token |
| `JWT authentication is not configured` | 401 | JWT_SECRET not set |
| `Not authorized to access this resource` | 403 | Insufficient role |
| `Not authorized to perform this action` | 403 | Missing permission |

## Examples

See the following files for complete examples:

- `app/api/jwt/route.ts` - NIP-98 login endpoint
- `app/api/jwt/protected/route.ts` - JWT-only protected endpoint
- `lib/auth/unified-auth.ts` - Unified auth middleware
- `lib/jwt-auth.ts` - JWT-specific authentication utilities
- `lib/jwt-client.ts` - Client-side NIP-98 login + token management
- `lib/auth/resolve-role.ts` - Role resolution logic
- `lib/auth/permissions.ts` - RBAC permission definitions

## Migrating from Direct NIP-98

If your routes previously used `validateNip98` directly:

1. Replace `import { validateNip98 } from '@/lib/nip98'` with `import { authenticate } from '@/lib/auth/unified-auth'`
2. Replace `const { pubkey } = await validateNip98(request)` with `const { pubkey } = await authenticate(request)`
3. For admin routes, use `authenticateWithRole(request, Role.ADMIN)` instead of `validateAdminAuth(request)`
4. Client-side: replace manual NIP-98 header creation with `jwtClient.setSigner(signer)` + `jwtClient.login()`
5. Client-side: replace manual `Authorization: Nostr` headers with `jwtClient.authenticatedRequest(url)`

Routes updated to unified auth automatically accept both NIP-98 and JWT authentication, providing backward compatibility.
