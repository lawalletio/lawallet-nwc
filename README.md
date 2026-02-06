<img src="/public/logos/lawallet.png" alt="LaWallet Logo" width="400" />

# LaWallet NWC

**Lightning Address Platform with Nostr Wallet Connect**

> **Pre-Alpha** — Do not use real data. Expect breaking changes!

An open-source platform for creating, managing, and serving Lightning Addresses connected via NWC. Built on a progressive self-custody model -- users start receiving payments instantly through address aliasing, then upgrade to NWC and eventually self-hosting at their own pace.

**Stack:** Next.js 16 + TypeScript + Prisma + PostgreSQL

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flawalletio%2Flawallet-nwc&project-name=lawallet-nwc&repository-name=lawallet-nwc&demo-title=lawallet%20nwc&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD)

---

## Features

### Admin

- Create and manage Boltcard designs
- Create and manage Lightning Addresses
- Create and manage Boltcard cards (NFC)

### User

- Webapp Wallet
- Create and manage Lightning Addresses
- Manage Boltcard cards (NFC)
- Setup with NWC

### Landing Page

- Fully responsive
- Instructions
- Waitlist form (Sendy subscription)

---

## Architecture

Three independent containerized services with no shared infrastructure:

| Service | Container | Description |
|---------|-----------|-------------|
| [Web Application](./docs/services/LAWALLET-WEB.md) | `lawallet-web` | Next.js app: frontend, REST API, lightning address resolution |
| [NWC Proxy](./docs/services/NWC-PROXY.md) | `lawallet-nwc-proxy` | Provisions courtesy NWC connections from external providers |
| [Payment Listener](./docs/services/NWC-LISTENER.md) | `lawallet-listener` | Monitors NWC relays, dispatches webhooks on payments |

---

## Tech Stack

- **TypeScript** [v5.0+](https://www.typescriptlang.org/) — Typed JavaScript
- **React** ([Next.js](https://nextjs.org/) v16) — Web framework
- **Tailwind CSS** [v3.3+](https://tailwindcss.com/) — Utility-first CSS
- **shadcn/ui** [v0.4+](https://ui.shadcn.com/) — UI component library
- **Prisma** [v4.16+](https://www.prisma.io/) — Database ORM
- **PostgreSQL** — Relational database
- **Alby lib** [v1.6+](https://github.com/getAlby/js-sdk) — NWC library
- [Radix UI](https://www.radix-ui.com/) — Headless UI primitives
- [Lucide Icons](https://lucide.dev/) — Icon library

---

## Open Standards

| Standard | Protocol | Usage |
|----------|----------|-------|
| NIP-47 | Nostr Wallet Connect | Payment connections |
| NIP-05 | Nostr Identity | User verification |
| NIP-07 / NIP-46 | Nostr Signing | Browser + remote auth |
| NIP-57 | Zaps | Lightning tips via Nostr |
| LUD-16 | [Lightning Address](https://github.com/lnurl/luds/blob/luds/16.md) | Address resolution |
| LUD-21 | [Verify](https://github.com/lnurl/luds/blob/luds/21.md) | Payment verification |
| LUD-22 | Webhooks | Payment notifications |
| BoltCard | [NFC Lightning](https://github.com/boltcard/boltcard) | NFC card payments |

---

## Getting Started

### 1. Install dependencies

Set the correct Node version with `nvm`:

```bash
nvm use
```

Install dependencies:

```bash
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your own values.

### 3. Generate Prisma client and run migrations

```bash
pnpm prisma generate
pnpm prisma migrate deploy
pnpm prisma db seed
```

### 4. Run the development server

```bash
pnpm dev
```

### 5. Open your browser

- **App:** [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard:** [http://localhost:3000/admin](http://localhost:3000/admin)
- **Wallet:** [http://localhost:3000/wallet](http://localhost:3000/wallet)

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design, data flow, address resolution |
| [ROADMAP.md](./docs/ROADMAP.md) | 6-month development timeline and current progress |
| [ONBOARDING.md](./docs/ONBOARDING.md) | Progressive self-custody: alias → NWC → self-hosted |
| [SDK.md](./docs/SDK.md) | TypeScript Client SDK + React Hooks reference |
| [TESTING.md](./docs/TESTING.md) | Testing strategy (Vitest, MSW, Playwright) |
| [DOCKER.md](./docs/DOCKER.md) | Docker setup and containerized deployment |
| [VISION.md](./docs/VISION.md) | Post-grant vision: CRM + AI + Nostr communications |

### Roadmap by Month

| Month | Focus | Status |
|-------|-------|--------|
| [1](./docs/roadmap/MONTH-1.md) | Backend infrastructure + testing | Completed |
| [2](./docs/roadmap/MONTH-2.md) | CI/CD + Client SDK + React Hooks | In Progress |
| [3](./docs/roadmap/MONTH-3.md) | Admin Dashboard + Nostr login + E2E | Planned |
| [4](./docs/roadmap/MONTH-4.md) | User Dashboard + Courtesy NWC Proxy | Planned |
| [5](./docs/roadmap/MONTH-5.md) | Lightning compliance + NWC Listener | Planned |
| [6](./docs/roadmap/MONTH-6.md) | Documentation + deployment | Planned |

### Changelogs

| Period | Document |
|--------|----------|
| Jan 5 - Feb 5, 2026 | [MONTH-1.md](./docs/changelogs/MONTH-1.md) |

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
