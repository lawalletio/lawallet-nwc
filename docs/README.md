# LaWallet NWC

**Lightning Address Platform with Nostr Wallet Connect**

An open-source platform for creating, managing, and serving Lightning Addresses connected via NWC. Built on a progressive self-custody model -- users start receiving payments instantly through address aliasing, then upgrade to NWC and eventually self-hosting at their own pace.

**Status:** Pre-Alpha | **Stack:** Next.js 16 + TypeScript + Prisma + PostgreSQL

---

## Architecture

Three independent containerized services with no shared infrastructure:

| Service | Container | Description |
|---------|-----------|-------------|
| [Web Application](./services/LAWALLET-WEB.md) | `lawallet-web` | Next.js app: frontend, REST API, lightning address resolution |
| [NWC Proxy](./services/NWC-PROXY.md) | `lawallet-nwc-proxy` | Provisions courtesy NWC connections from external providers |
| [Payment Listener](./services/NWC-LISTENER.md) | `lawallet-listener` | Monitors NWC relays, dispatches webhooks on payments |

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, data flow, address resolution |
| [ROADMAP.md](./ROADMAP.md) | 6-month development timeline and current progress |
| [ONBOARDING.md](./ONBOARDING.md) | Progressive self-custody: alias -> NWC -> self-hosted |
| [SDK.md](./SDK.md) | TypeScript Client SDK + React Hooks reference |
| [TESTING.md](./TESTING.md) | Testing strategy (Vitest, MSW, Playwright) |
| [VISION.md](./VISION.md) | Post-grant vision: CRM + AI + Nostr communications |

### Roadmap by Month

| Month | Focus | Status |
|-------|-------|--------|
| [1](./roadmap/MONTH-1.md) | Backend infrastructure + testing | Completed |
| [2](./roadmap/MONTH-2.md) | CI/CD + Client SDK + React Hooks | In Progress |
| [3](./roadmap/MONTH-3.md) | Admin Dashboard + Nostr login + E2E | Planned |
| [4](./roadmap/MONTH-4.md) | User Dashboard + Courtesy NWC Proxy | Planned |
| [5](./roadmap/MONTH-5.md) | Lightning compliance + NWC Listener | Planned |
| [6](./roadmap/MONTH-6.md) | Documentation + deployment | Planned |

### Changelogs

| Period | Document |
|--------|----------|
| Jan 5 - Feb 5, 2026 | [MONTH-1.md](./changelogs/MONTH-1.md) |

---

## Open Standards

| Standard | Protocol | Usage |
|----------|----------|-------|
| NIP-47 | Nostr Wallet Connect | Payment connections |
| NIP-05 | Nostr Identity | User verification |
| NIP-07 / NIP-46 | Nostr Signing | Browser + remote auth |
| NIP-57 | Zaps | Lightning tips via Nostr |
| LUD-16 | Lightning Address | Address resolution |
| LUD-21 | Verify | Payment verification |
| LUD-22 | Webhooks | Payment notifications |

---

## License

MIT

---

<p align="center">
  <br />
  Supported by
  <br /><br />
  <a href="https://opensats.org">
    <img src="https://opensats.org/logo.svg" alt="OpenSats" width="150" />
  </a>
</p>
