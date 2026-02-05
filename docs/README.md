# LaWallet NWC

**Lightning Address Platform using Nostr Wallet Connect**

LaWallet NWC enables users and organizations to create, manage, and serve Lightning Addresses connected via Nostr Wallet Connect (NWC). The platform prioritizes frictionless onboarding through lightning address aliasing and redirect, allowing users to start receiving payments immediately with their existing wallet, then progressively migrate to NWC and eventually self-hosting.

---

## Project Status

- **Version**: 1.0
- **Date**: February 2026
- **Status**: Pre-Alpha
- **Repository**: [github.com/lawalletio/lawallet-nwc](https://github.com/lawalletio/lawallet-nwc)
- **Stack**: Next.js 14 + TypeScript + Prisma + PostgreSQL + Tailwind/shadcn
- **Timeline**: 6-month development roadmap

---

## Key Concepts

- **Lightning Address as Alias**: Users get an address that redirects to their existing wallet — zero friction onboarding
- **Progressive Self-Custody**: alias → courtesy NWC → own NWC → self-hosted LaWallet
- **Three Independent Services**: No shared infrastructure between containers
- **Nostr-Native**: NWC for payments, NIP-05 for identity, Nostr relays for messaging

---

## Documentation Index

### Core

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, 3 independent services, data flow |
| [ROADMAP.md](./ROADMAP.md) | 6-month timeline summary |
| [ONBOARDING.md](./ONBOARDING.md) | User progression: alias → NWC → self-hosted |
| [SDK.md](./SDK.md) | TypeScript Client SDK + React Hooks reference |
| [TESTING.md](./TESTING.md) | Testing strategy and tools |
| [VISION.md](./VISION.md) | Post-grant: CRM + AI + Nostr communications |

### Monthly Breakdown

| Month | Focus | Document |
|-------|-------|----------|
| 1 | Testing + CI/CD | [MONTH-1.md](./months/MONTH-1.md) |
| 2 | Integration tests + SDK + Hooks | [MONTH-2.md](./months/MONTH-2.md) |
| 3 | Admin Dashboard + Auth + Courtesy NWC + E2E | [MONTH-3.md](./months/MONTH-3.md) |
| 4 | User Dashboard + Wallet Completion | [MONTH-4.md](./months/MONTH-4.md) |
| 5 | Lightning Compliance + NWC Listener | [MONTH-5.md](./months/MONTH-5.md) |
| 6 | Documentation + Deployment | [MONTH-6.md](./months/MONTH-6.md) |

### Service Specifications

| Service | Container | Document |
|---------|-----------|----------|
| Next.js Application | lawallet-web | [LAWALLET-WEB.md](./services/LAWALLET-WEB.md) |
| NWC Payment Listener | lawallet-listener | [NWC-LISTENER.md](./services/NWC-LISTENER.md) |
| Courtesy NWC Proxy | lawallet-nwc-proxy | [NWC-PROXY.md](./services/NWC-PROXY.md) |

---

## Current Gaps

| Gap | Priority |
|-----|----------|
| No testing infrastructure | P0 Critical |
| No CI/CD pipeline | P0 Critical |
| No alias/redirect system | P0 Critical |
| No courtesy NWC proxy | P1 High |
| Incomplete LUD compliance (16/21/22) | P1 High |
| No webhook system | P1 High |
| No structured logging | P1 High |
| No client SDK or React hooks | P2 Medium |
| No documentation | P2 Medium |
