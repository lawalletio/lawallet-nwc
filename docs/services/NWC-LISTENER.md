# lawallet-listener: NWC Payment Listener

## Overview

Standalone Node.js microservice that monitors NWC relays for incoming payment events and dispatches webhook notifications.

**Container**: `lawallet-listener`
**Ports**: 3001 (WebSocket), 3002 (health check)
**Storage**: Own storage (event logs, delivery tracking)

---

## Responsibilities

- Subscribe to NWC relays for NIP-47 `payment_received` events
- Match incoming payments to registered lightning addresses
- Dispatch LUD-22 webhooks with HMAC-signed payloads
- Emit real-time events via WebSocket to lawallet-web
- Track delivery status and manage retries

---

## Independence

- Own storage for event logs and delivery tracking
- No dependency on lawallet-web database
- No dependency on lawallet-nwc-proxy
- Communicates with lawallet-web via WebSocket events only
- Can be restarted without data loss (stateless design)

---

## Payment Detection Flow

1. Subscribe to NWC relays listed in configuration
2. Monitor NIP-47 `payment_received` events per connected wallet
3. Match payment to registered lightning address via invoice/preimage
4. Record event in own storage (amount, timestamp, sender, address)
5. Look up registered LUD-22 webhooks for the address
6. POST signed JSON payload to each webhook URL
7. Emit WebSocket event to lawallet-web for real-time display

---

## Webhook Delivery

- **Method**: POST
- **Content-Type**: `application/json`
- **Signature**: `X-Signature` header with HMAC-SHA256 of payload using webhook secret
- **Retry**: Exponential backoff — 3 attempts (1s, 4s, 16s)
- **Dead letter queue**: Permanently failed deliveries stored for manual inspection
- **Delivery status**: Logged and queryable

---

## Resilience

- Auto-reconnection on relay disconnection with exponential backoff
- Graceful shutdown on SIGTERM/SIGINT
- Health check endpoint at `/health` (port 3002)
- Multi-relay subscription for redundancy
- Stateless design: restart without data loss

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NWC_RELAY_URLS` | Comma-separated NWC relay URLs | `wss://relay.getalby.com/v1` |
| `WEBHOOK_RETRY_ATTEMPTS` | Retry attempts per delivery | `3` |
| `WEBHOOK_RETRY_BASE_DELAY` | Base delay (ms) for exponential backoff | `1000` |
| `WEBSOCKET_PORT` | Port for WebSocket event emission | `3001` |
| `HEALTH_CHECK_PORT` | Health check endpoint port | `3002` |
| `LOG_LEVEL` | Minimum log level | `info` |

---

## Tech Stack

- **Runtime**: Node.js (TypeScript)
- **Protocol**: NIP-47 (Nostr Wallet Connect)
- **Logging**: pino (JSON structured)
- **Container**: Dedicated Docker image

---

## Testing

- Integration tests with mocked NWC relay
- Webhook delivery tests with mock HTTP endpoints
- Retry and dead letter queue tests
- Reconnection behavior tests
