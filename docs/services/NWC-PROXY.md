# lawallet-nwc-proxy: Courtesy NWC Proxy

## Overview

Lightweight standalone Node.js service that acts as a provider-agnostic proxy for provisioning temporary NWC connection strings. Does not hold funds.

**Container**: `lawallet-nwc-proxy`
**Ports**: 3003 (API), 3004 (health check)
**Storage**: Own storage (connection tracking, provider credentials)

---

## Purpose

Enables users to upgrade from alias/redirect to NWC-connected addresses without needing their own wallet infrastructure. The proxy provisions temporary NWC connection strings from external providers and returns them to the user.

---

## Independence

- Own container, own storage
- No access to lawallet-web database
- No access to lawallet-listener
- Communicates with lawallet-web via HTTP API only
- Stateless proxy: does not hold or manage funds

---

## Supported Providers

| Provider | Protocol | Notes |
|----------|----------|-------|
| Alby Hub | OAuth + NWC | Provisions via Alby account API |
| LNBits | API + NWC | Provisions via LNBits wallet API |
| BTCPayServer | API + NWC | Provisions via BTCPay Greenfield API |
| YakiHonne | NWC | Direct NWC provisioning |
| Generic NWC | NWC string | Any provider exposing NWC connection strings |

---

## How It Works

1. User requests a courtesy NWC connection from the proxy
2. Proxy authenticates with the configured external NWC provider
3. Proxy provisions a new NWC connection string from the provider
4. Connection string is returned to the user and linked to their lightning address
5. Payments to the address now route via NWC instead of redirect
6. User can replace the courtesy NWC with their own wallet at any time

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/connections` | POST | Provision new courtesy NWC connection |
| `/connections/:id` | DELETE | Revoke courtesy NWC connection |
| `/connections/:id` | GET | Get connection status |
| `/providers` | GET | List available NWC providers |
| `/health` | GET | Health check |

### POST /connections

**Request:**
```json
{
  "provider": "alby",
  "userId": "user_123",
  "addressId": "addr_456"
}
```

**Response:**
```json
{
  "id": "conn_789",
  "provider": "alby",
  "nwcConnectionString": "nostr+walletconnect://...",
  "status": "active",
  "createdAt": "2026-03-15T10:00:00Z"
}
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PROVIDERS` | Enabled providers (comma-separated) | `alby` |
| `ALBY_CLIENT_ID` | Alby Hub OAuth client ID | (required if alby enabled) |
| `ALBY_CLIENT_SECRET` | Alby Hub OAuth client secret | (required if alby enabled) |
| `LNBITS_URL` | LNBits instance URL | (required if lnbits enabled) |
| `LNBITS_ADMIN_KEY` | LNBits admin API key | (required if lnbits enabled) |
| `BTCPAY_URL` | BTCPayServer instance URL | (required if btcpay enabled) |
| `BTCPAY_API_KEY` | BTCPayServer Greenfield API key | (required if btcpay enabled) |
| `PORT` | Service port | `3003` |
| `HEALTH_CHECK_PORT` | Health endpoint port | `3004` |
| `LOG_LEVEL` | Minimum log level | `info` |

---

## Design Principles

- **Stateless proxy**: Does not hold funds, only provisions connection strings
- **Provider-agnostic**: Unified API abstracting differences between providers
- **Extensible**: Adding a new provider = implementing one adapter interface
- **Independent**: No shared infrastructure with other services

---

## Provider Adapter Interface

Each provider implements a common interface:

```typescript
interface NWCProvider {
  name: string;
  provision(userId: string): Promise<NWCConnection>;
  revoke(connectionId: string): Promise<void>;
  status(connectionId: string): Promise<ConnectionStatus>;
}
```

---

## Tech Stack

- **Runtime**: Node.js (TypeScript)
- **Logging**: pino (JSON structured)
- **Container**: Dedicated Docker image

---

## React Hook Integration

The frontend consumes this service via the `useCourtesyNWC` hook:

```typescript
const { provision, revoke, status, isLoading, error } = useCourtesyNWC();

// Provision a new connection
const connection = await provision({ provider: 'alby' });

// Check status
const currentStatus = await status(connection.id);

// Revoke when upgrading to own wallet
await revoke(connection.id);
```
