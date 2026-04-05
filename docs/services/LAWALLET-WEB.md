# lawallet-web: Next.js Application

## Overview

The main application serving the frontend, REST API, admin dashboard, user dashboard, wallet interface, and lightning address resolution endpoints.

**Container**: `lawallet-web`
**Port**: 3000
**Storage**: Own PostgreSQL database (Prisma ORM)

---

## Responsibilities

- Serve frontend (React + Tailwind/shadcn)
- Expose REST API for all platform operations
- Resolve lightning addresses via `.well-known/lnurlp` (LUD-16)
- Serve NIP-05 identity via `.well-known/nostr.json`
- Handle alias/redirect resolution (proxy LNURL-pay to target)
- Admin dashboard
- User dashboard (profile, npub, address config, preferences)
- Wallet interface (payments, NWC connection)
- Authentication (JWT + Nostr)
- White-label customization
- Redirect root traffic to the dedicated `lawallet-landing` site

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Frontend**: React + Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL via Prisma ORM
- **NWC**: Alby JS SDK
- **Testing**: Vitest + React Testing Library + Playwright + MSW
- **Logging**: pino

---

## Directory Structure

| Path | Purpose |
|------|---------|
| `/app` | Next.js App Router pages and API routes |
| `/app/admin` | Admin dashboard pages |
| `/app/wallet` | Wallet interface |
| `/app/.well-known` | LUD-16 + NIP-05 endpoints |
| `/app/api` | REST API routes |
| `/components` | Shared React components |
| `/lib` | Shared utilities, types, constants |
| `/prisma` | Database schema, migrations, seeds |

**Note:** the public landing now lives in [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing). `lawallet-web` keeps `/` as a redirect so deployments can share the same domain cleanly.

---

## Key Endpoints

### Lightning Address

- `GET /.well-known/lnurlp/:username` — LUD-16 resolution (with alias/redirect support)
- `GET /.well-known/nostr.json?name=:username` — NIP-05 identity verification

### API

- `POST /api/jwt` — NIP-98 login (exchange Nostr auth event for JWT session token)
- `GET /api/jwt` — Validate JWT and return claims (pubkey, role, permissions)
- `GET /api/jwt/protected` — Example JWT-protected endpoint
- `GET /api/addresses` — List addresses
- `POST /api/addresses` — Create address
- `GET /api/addresses/:id` — Get address details
- `PUT /api/addresses/:id` — Update address
- `DELETE /api/addresses/:id` — Delete address
- `PUT /api/addresses/:id/redirect` — Set redirect target
- `GET /api/users` — List users (admin)
- `GET /api/users/:id` — Get user details
- `PUT /api/users/:id` — Update user
- `GET /api/webhooks` — List webhooks
- `POST /api/webhooks` — Register webhook
- `DELETE /api/webhooks/:id` — Remove webhook
- `GET /api/payments` — Payment history

---

## Communication with Other Services

- **lawallet-listener**: Receives WebSocket events for real-time payment updates
- **lawallet-nwc-proxy**: HTTP API calls to provision/revoke courtesy NWC connections
- No shared database or filesystem with either service
