# Architecture

## Overview

LaWallet NWC is composed of **three fully independent, containerized services**. Each runs in its own Docker container with its own database/storage. There is no shared infrastructure between services. They communicate exclusively via HTTP APIs and WebSocket events.

---

## Service Topology

| Container | Service | Ports | Storage |
|-----------|---------|-------|---------|
| `lawallet-web` | Next.js Application | 3000 | Own PostgreSQL (Prisma) |
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

- App Router (Next.js 14) serving frontend and API routes
- Frontend consumes React Hooks package for all data operations
- `.well-known/lnurlp` endpoint for LUD-16 lightning address resolution
- `.well-known/nostr.json` endpoint for NIP-05 identity verification
- Alias/redirect resolution: proxies LNURL-pay to target address when user has no NWC
- Admin dashboard for platform management
- User dashboard for profile, npub, address, and NWC management
- Wallet interface for payments and quick actions
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

## Data Flow

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

---

## Deployment Options

| Platform | Containers | Notes |
|----------|------------|-------|
| Vercel | web only | Listener + Proxy deployed separately |
| Netlify | web only | Same as Vercel |
| Umbrel | All 3 | Full app store package |
| Start9 | All 3 | Embassy package |
| Docker Compose | All 3 | Independent containers + reverse proxy |
