# JWT Authentication System

This document explains how to use the JWT authentication system in the Lawallet NWC application.

## Overview

The JWT system provides secure authentication using JSON Web Tokens, similar to the NIP98 implementation. It includes:

- **Server-side JWT library** (`lib/jwt.ts`) - Core JWT functions
- **Authentication middleware** (`lib/jwt-auth.ts`) - Route protection utilities
- **Client-side utilities** (`lib/jwt-client.ts`) - Token management on the frontend
- **API endpoints** (`/api/jwt/*`) - Token creation and validation

## Setup

### 1. Environment Variables

Add the following to your `.env.local` file:

```bash
JWT_SECRET=your-super-secret-jwt-key-here
```

**Important**: Use a strong, random secret key in production.

### 2. Dependencies

The required packages are already installed:

- `jsonwebtoken` - JWT creation and verification
- `@types/jsonwebtoken` - TypeScript types

## Server-Side Usage

### Creating JWT Tokens

```typescript
import { createJwtToken } from '@/lib/jwt'

const token = createJwtToken(
  {
    userId: 'user123',
    pubkey: 'pubkey123',
    role: 'admin',
    permissions: ['read', 'write']
  },
  process.env.JWT_SECRET!,
  {
    expiresIn: '24h',
    issuer: 'lawallet-nwc',
    audience: 'lawallet-users'
  }
)
```

### Verifying JWT Tokens

```typescript
import { verifyJwtToken } from '@/lib/jwt'

try {
  const result = verifyJwtToken(token, process.env.JWT_SECRET!)
  console.log('User ID:', result.payload.sub)
  console.log('Role:', result.payload.role)
} catch (error) {
  console.error('Token verification failed:', error.message)
}
```

### Protecting API Routes

#### Option 1: Using the middleware function

```typescript
import { authenticateJwt } from '@/lib/jwt-auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // Authenticate the request
  const authResult = await authenticateJwt(request, {
    requiredClaims: ['role']
  })

  if (authResult) {
    return authResult // Returns error response if auth fails
  }

  // Request is authenticated, proceed with your logic
  const userId = request.jwt?.payload.sub
  return NextResponse.json({ message: `Hello user ${userId}` })
}
```

#### Option 2: Using the higher-order function (Recommended)

```typescript
import { withJwtAuth, getUserIdFromRequest } from '@/lib/jwt-auth'
import { NextResponse } from 'next/server'
import type { AuthenticatedRequest } from '@/lib/jwt-auth'

async function protectedHandler(request: AuthenticatedRequest) {
  const userId = getUserIdFromRequest(request)

  return NextResponse.json({
    message: `Hello user ${userId}`,
    timestamp: new Date().toISOString()
  })
}

// Wrap with JWT authentication
export const GET = withJwtAuth(protectedHandler, {
  requiredClaims: ['role', 'permissions']
})
```

### Working with Authenticated Requests

```typescript
import {
  getUserIdFromRequest,
  getClaimFromRequest,
  hasClaim
} from '@/lib/jwt-auth'

async function handler(request: AuthenticatedRequest) {
  // Get user ID
  const userId = getUserIdFromRequest(request)

  // Get specific claims
  const role = getClaimFromRequest<string>(request, 'role')
  const permissions = getClaimFromRequest<string[]>(request, 'permissions')

  // Check claims
  if (hasClaim(request, 'role', 'admin')) {
    // Admin-only logic
  }

  if (hasClaim(request, 'permissions', 'write')) {
    // Write permission logic
  }
}
```

## Client-Side Usage

### Basic Token Management

```typescript
import { jwtClient } from '@/lib/jwt-client'

// Request a new token
const tokenData = await jwtClient.requestToken(
  'user123',
  { role: 'user', permissions: ['read'] },
  '24h'
)

// Check if token exists
if (jwtClient.hasStoredToken()) {
  console.log('User is authenticated')
}

// Get auth header for requests
const authHeader = jwtClient.getAuthHeader()
// Returns: "Bearer eyJhbGciOiJIUzI1NiIs..."

// Logout
jwtClient.logout()
```

### Making Authenticated Requests

```typescript
import { jwtClient } from '@/lib/jwt-client'

// Simple authenticated request
const response = await jwtClient.authenticatedRequest('/api/protected-endpoint')

// With custom options
const response = await jwtClient.authenticatedRequest('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'John Doe' })
})
```

### Token Validation

```typescript
import { jwtClient } from '@/lib/jwt-client'

// Validate stored token
const isValid = await jwtClient.validateStoredToken()

if (!isValid) {
  // Token is invalid, redirect to login
  jwtClient.logout()
  // redirect to login page
}
```

## API Endpoints

### POST /api/jwt

Request a new JWT token.

**Request Body:**

```json
{
  "userId": "user123",
  "expiresIn": "24h",
  "additionalClaims": {
    "role": "admin",
    "permissions": ["read", "write"]
  }
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

### GET /api/jwt

Validate an existing JWT token.

**Headers:**

```
Authorization: Bearer <token>
```

**Response:**

```json
{
  "valid": true,
  "userId": "user123",
  "issuedAt": "2024-01-01T00:00:00.000Z",
  "expiresAt": "2024-01-02T00:00:00.000Z",
  "additionalClaims": {
    "role": "admin",
    "permissions": ["read", "write"]
  }
}
```

## Security Considerations

1. **Secret Key**: Use a strong, random secret key and keep it secure
2. **Token Expiration**: Set reasonable expiration times
3. **HTTPS**: Always use HTTPS in production
4. **Token Storage**: Store tokens securely (localStorage for client-side)
5. **Claims**: Only include necessary claims in tokens
6. **Validation**: Always validate tokens on the server side

## Error Handling

The system provides detailed error messages for common issues:

- `Authorization header is required` - Missing auth header
- `Authorization header must start with "Bearer "` - Invalid header format
- `Token has expired` - Token is past expiration
- `Invalid token` - Malformed or corrupted token
- `Missing required claim: <claim>` - Required claim not present

## Examples

See the following files for complete examples:

- `app/api/jwt/protected/route.ts` - Protected endpoint example
- `lib/jwt-auth.ts` - Authentication utilities
- `lib/jwt-client.ts` - Client-side token management

## Migration from NIP98

If you're migrating from NIP98 to JWT:

1. Replace `createNip98Token` calls with `jwtClient.requestToken`
2. Replace `validateNip98` calls with `withJwtAuth` wrapper
3. Update client-side code to use `jwtClient.authenticatedRequest`
4. Update environment variables (add `JWT_SECRET`)

The JWT system provides similar functionality with better performance and broader compatibility.
