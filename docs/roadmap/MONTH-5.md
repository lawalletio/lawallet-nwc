# Month 5: Lightning Address Compliance + NWC Payment Listener

**Period:** May 5 - June 5, 2026
**Status:** Planned
**Depends on:** Month 4 (User Dashboard + Courtesy NWC Proxy)

## Summary

Achieve full protocol compliance for lightning address standards and build the NWC Payment Listener as a second independent service container.

---

## Goals

- Achieve full LUD-16, LUD-21, LUD-22, NIP-57 compliance
- Implement full alias/redirect resolution in LUD-16 flow
- Build and deploy NWC Payment Listener as independent container
- Update SDK and hooks for new protocols

---

## LUD-16: Lightning Address (Full Compliance)

The existing `/api/lud16/[username]` and callback routes provide basic LUD-16 support. This month brings full spec compliance.

- Complete `.well-known/lnurlp` endpoint per specification
- Proper metadata fields in LNURL-pay response
- `allowsNostr` and `nostrPubkey` fields for NIP-57 compatibility
- Comment support with configurable max length
- Min/max sendable configuration per address
- Alias/redirect resolution integrated into LUD-16 flow:
  - Detect if user has redirect target
  - Proxy LNURL-pay request to target address
  - Transparent to sender

---

## NIP-57: Nostr Zaps

- Zap receipt creation (kind 9735 Nostr events)
- `nostrPubkey` field in LNURL-pay responses
- Zap verification endpoint
- Integration testing with Nostr clients (Damus, Amethyst, Primal)

---

## LUD-21: Verify Endpoint

- Payment settlement verification API
- Verify field in LNURL callback responses
- Status check endpoint for payment confirmation

---

## LUD-22: Webhooks

- Webhook registration REST API
- Delivery queue with exponential backoff retry (3 attempts: 1s, 4s, 16s)
- Dead letter queue for permanently failed deliveries
- Webhook management UI in admin dashboard
- Event types: `payment_received`, `payment_failed`
- HMAC-SHA256 signature verification header on all payloads
- Webhook secret per registration

---

## Lightning Address Redirect (Full Implementation)

- Redirect target configuration per address via API and admin UI
- Proxy LNURL-pay requests to redirect target transparently
- Redirect status tracking and logging
- Redirect health monitoring (detect if target address is unreachable)
- User notification if redirect target is down

---

## NWC Payment Listener Service (New Container)

### Overview

Standalone long-running Node.js process in its own Docker container. Monitors NWC relays for incoming payment events and dispatches webhook notifications. See [NWC-LISTENER.md](../services/NWC-LISTENER.md) for full specification.

### Functionality

- Subscribes to NWC relays for NIP-47 `payment_received` events
- Matches incoming payments to registered lightning addresses
- Dispatches LUD-22 webhooks with HMAC-signed JSON payloads
- Emits real-time events via WebSocket to the Next.js app
- Records events in own storage

### Webhook Delivery

- POST request with `Content-Type: application/json`
- `X-Signature` header with HMAC-SHA256 of payload
- Exponential backoff retry: 3 attempts (1s, 4s, 16s)
- Dead letter queue for permanently failed deliveries

### Resilience

- Auto-reconnection on relay disconnection with backoff
- Graceful shutdown on SIGTERM/SIGINT
- Health check endpoint (`/health`)
- Stateless: can restart without data loss

### Independence

- Own storage for event logs and delivery tracking
- No dependency on Next.js app database
- No dependency on Courtesy NWC Proxy
- Communicates with Next.js app via WebSocket only

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NWC_RELAY_URLS` | Comma-separated relay URLs | `wss://relay.getalby.com/v1` |
| `WEBHOOK_RETRY_ATTEMPTS` | Retry attempts per delivery | `3` |
| `WEBHOOK_RETRY_BASE_DELAY` | Base delay (ms) for backoff | `1000` |
| `WEBSOCKET_PORT` | WebSocket event port | `3001` |
| `HEALTH_CHECK_PORT` | Health endpoint port | `3002` |
| `LOG_LEVEL` | Minimum log level | `info` |

---

## SDK + Hooks Update

### New SDK Methods

- LUD-21 verify endpoint methods
- LUD-22 webhook management methods
- Zap send/receive/verify methods
- Redirect configuration methods

### New Hooks

| Hook | Purpose |
|------|---------|
| `useZap` | Send/receive zaps, verify receipts |
| `useVerify` | Payment settlement status (LUD-21) |
| `useRedirect` | Address alias/redirect configuration |
| `useWebhooks` (updated) | LUD-22 webhook management |

---

## Protocol Compliance Matrix

| Standard | Name | Status After Month 5 |
|----------|------|---------------------|
| LUD-16 | Lightning Address | Full compliance (with alias/redirect) |
| LUD-21 | Verify | Full compliance |
| LUD-22 | Webhooks | Full compliance |
| NIP-57 | Zaps | Full compliance |
| NIP-47 | NWC | Used by Listener service |

---

## Acceptance Criteria

| Deliverable | Criteria | Priority |
|-------------|----------|----------|
| LUD-16 | .well-known/lnurlp fully compliant, alias/redirect working | P0 |
| NIP-57 | Zap receipts created and verified | P0 |
| LUD-21 | Verify endpoint functional | P1 |
| LUD-22 | Webhooks registered, delivered with retry, HMAC signed | P0 |
| Redirect | Full implementation with health monitoring | P0 |
| NWC Listener | Container running, detecting payments, dispatching webhooks | P0 |
| SDK/Hooks | New methods and hooks published | P1 |
