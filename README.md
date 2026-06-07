<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/apps/web/public/logos/lawallet.svg">
  <img src="/apps/web/public/logos/lawallet.png" alt="LaWallet Logo" width="400" />
</picture>

---

[![CI](https://github.com/lawalletio/lawallet-nwc/actions/workflows/ci.yml/badge.svg)](https://github.com/lawalletio/lawallet-nwc/actions/workflows/ci.yml)
[![Security](https://github.com/lawalletio/lawallet-nwc/actions/workflows/security.yml/badge.svg)](https://github.com/lawalletio/lawallet-nwc/actions/workflows/security.yml)
[![codecov](https://codecov.io/gh/lawalletio/lawallet-nwc/branch/main/graph/badge.svg)](https://codecov.io/gh/lawalletio/lawallet-nwc)
[![License: MIT](https://img.shields.io/github/license/lawalletio/lawallet-nwc?color=blue)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/lawalletio/lawallet-nwc?include_prereleases&sort=semver)](https://github.com/lawalletio/lawallet-nwc/releases)
[![Last Commit](https://img.shields.io/github/last-commit/lawalletio/lawallet-nwc)](https://github.com/lawalletio/lawallet-nwc/commits/main)

[![Status: Pre-Alpha](https://img.shields.io/badge/status-pre--alpha-orange)](./README.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.14-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![⚡ Lightning](https://img.shields.io/badge/⚡-Lightning_Network-792EE5)](https://lightning.network)
[![Nostr](https://img.shields.io/badge/Nostr-Protocol-8E44AD)](https://nostr.com)
[![Funded by OpenSats](https://img.shields.io/badge/Funded_by-OpenSats-F7931A)](https://opensats.org)

# LaWallet NWC

**Lightning Address Platform and Nostr CRM**

An open-source platform for creating, managing, and serving Lightning Addresses connected via NWC. Built on a progressive self-custody model — users start receiving payments instantly through address aliasing, then upgrade to NWC and eventually self-hosting at their own pace.

> **Pre-Alpha** — Do not use real funds. Expect breaking changes.

# Try Demo 👇

<p align="center">
  <a href="https://beta.lawallet.io"><img src="https://img.shields.io/badge/Live_Demo-beta.lawallet.io-F5A623?style=for-the-badge&logo=lightning&logoColor=white" alt="Live Demo" /></a>
  <a href="https://docs.lawallet.io"><img src="https://img.shields.io/badge/Documentation-docs.lawallet.io-26A69A?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
  <a href="https://beta.lawallet.io/api-docs"><img src="https://img.shields.io/badge/API_Playground-Try_it_live-3178C6?style=for-the-badge&logo=swagger&logoColor=white" alt="API Playground" /></a>
</p>

# One Click Deploy 👇

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flawalletio%2Flawallet-nwc&project-name=lawallet-nwc&repository-name=lawallet-nwc&root-directory=apps%2Fweb&demo-title=lawallet%20nwc&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD&env=JWT_SECRET&envDescription=JWT_SECRET%20must%20be%20a%2032%2B%20character%20random%20string.%20Generate%20one%20with%3A%20openssl%20rand%20-base64%2032&envLink=https%3A%2F%2Fgithub.com%2Flawalletio%2Flawallet-nwc%2Fblob%2Fmain%2Fapps%2Fweb%2F.env.example)

---

## Features

### Admin Dashboard

- Nostr-based login (NIP-07 browser extension, NIP-46 remote signing, nsec)
- BoltCard fleet management — designs, NTAG424 cards, OTC activation
- Lightning Address management — domain claim, alias / NWC modes, LUD-16 routing
- Multi-tab Settings — Branding (8 presets + image uploads), Wallet, Infrastructure
- Activity Log + real-time stats via Server-Sent Events

### User Wallet

- Onboarding flow with Send / Receive / Scan
- Lightning Address claim and management
- BoltCard pairing and NFC tap-to-pay
- NWC connection (Alby, Primal, or any NWC-compatible wallet)
- Offline cache for resilience

### Developer Surface

- TypeScript SDK (npm package) covering all 47 endpoints
- React Hooks via `@lawallet-nwc/react`
- OpenAPI 3.1 spec + interactive [Scalar Playground](https://beta.lawallet.io/api-docs)
- One-click deploy to Vercel; Docker, Umbrel, and Start9 targets in flight

> The public marketing site lives in [`lawallet-landing`](https://github.com/lawalletio/lawallet-landing). This repo's `/` redirects there; the product entrypoint is `/admin`.

---

## Architecture

Three independent containerized services with no shared infrastructure:

| Service | Container | Status | Role |
|---------|-----------|--------|------|
| [Web Application](./docs/services/LAWALLET-WEB.md) | `lawallet-web` | Active | Next.js frontend, REST API, Lightning Address resolution, dashboards, wallet |
| [Payment Listener](./docs/services/NWC-LISTENER.md) | `lawallet-listener` | M5 (Lite) | Monitors NWC relays, dispatches LUD-22 webhooks |
| [NWC Proxy](./docs/services/NWC-PROXY.md) | `lawallet-nwc-proxy` | M6 (Lite) | Provisions courtesy NWC connections via external providers |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | [TypeScript 5.9](https://www.typescriptlang.org/) |
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Database | [PostgreSQL](https://www.postgresql.org/) via [Prisma 6.19](https://www.prisma.io/) |
| Styling | [Tailwind CSS 3.4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) |
| Lightning / NWC | [Alby SDK 7](https://github.com/getAlby/js-sdk), [nostr-tools](https://github.com/nbd-wtf/nostr-tools), [@nostrify/nostrify](https://gitlab.com/soapbox-pub/nostrify) |
| Testing | [Vitest 3.2](https://vitest.dev/) + [MSW](https://mswjs.io/) + [happy-dom](https://github.com/capricorn86/happy-dom) |
| Tooling | [pnpm 10](https://pnpm.io/) workspaces + [Turborepo 2](https://turbo.build/) |
| Runtime | [Node.js ≥22.14](./.nvmrc) |

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

### Bootstrap With the CLI

The standalone bootstrap flow is designed for a hosted `curl | bash` install:

```bash
curl -fsSL https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/install.sh | bash
```

To force Docker mode and skip prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/lawalletio/lawallet-nwc/main/install.sh | \
  bash -s -- --mode docker --yes
```

That installer:

- installs a user-owned `lawallet` CLI under `~/.lawallet/bin`
- downloads a bundled Node.js runtime when the machine does not already have a compatible one
- persists the CLI on your shell `PATH`
- runs `lawallet install`, which clones `lawallet-nwc` and brings up `web`, `docs`, `openapi`, and PostgreSQL

For local development of the CLI from this repo, use the wrapper script instead:

```bash
bash ./scripts/install-lawallet-cli.sh
```

That wrapper reuses the same root [`install.sh`](./install.sh) flow, but installs the CLI package directly from [`apps/cli`](./apps/cli) instead of npm.

Once an instance is installed, the generated app-management commands are available from `apps/web` through `pnpm service <status|start|stop|restart>`.

Useful bootstrap env vars:

```bash
LAWALLET_REPO_URL=https://github.com/your-org/lawallet-nwc.git
LAWALLET_CLI_NPM_SPEC=@lawallet-nwc/cli@latest
LAWALLET_INSTALL_SKIP_RUN=true
LAWALLET_INSTALL_SKIP_PROFILE=true
```

To smoke-test the published bootstrap flow inside Docker, run:

```bash
bash ./scripts/test-install-cli-docker.sh
```

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

| Surface | Local URL |
|---------|-----------|
| Admin Dashboard | http://localhost:3000/admin |
| User Wallet | http://localhost:3000/wallet |
| API Playground | http://localhost:3000/api-docs |
| Landing redirect | http://localhost:3000 → `NEXT_PUBLIC_LAWALLET_LANDING_URL` |

---

## Documentation

The full rendered docs live at **[docs.lawallet.io](https://docs.lawallet.io)**. The interactive REST reference is at **[beta.lawallet.io/api-docs](https://beta.lawallet.io/api-docs)**. Source documents in this repo:

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design, data flow, address resolution |
| [ROADMAP.md](./docs/ROADMAP.md) | 8-month development timeline and current progress |
| [ONBOARDING.md](./docs/ONBOARDING.md) | Progressive self-custody: alias → NWC → self-hosted |
| [SDK.md](./docs/SDK.md) | TypeScript Client SDK + React Hooks reference |
| [TESTING.md](./docs/TESTING.md) | Testing strategy (Vitest, MSW, Playwright) |
| [DOCKER.md](./docs/DOCKER.md) | Docker setup and containerized deployment |
| [VISION.md](./docs/VISION.md) | Long-term vision: CRM + AI + Nostr communications (Beyond M8) |

### Roadmap by Month

| Month | Phase | Focus | Status |
|-------|-------|-------|--------|
| [1](./docs/roadmap/MONTH-1.md) | Foundation | Backend infrastructure + testing | ✅ Completed · [Report](./docs/reports/MONTH-1.md) |
| [2](./docs/roadmap/MONTH-2.md) | Foundation | CI/CD + Auth flow upgrade | ✅ Completed · [Report](./docs/reports/MONTHS-2-3.md) |
| [3](./docs/roadmap/MONTH-3.md) | Enhancement | Admin Dashboard + Nostr login + E2E | ✅ Completed · [Report](./docs/reports/MONTHS-2-3.md) |
| [4](./docs/roadmap/MONTH-4.md) | Enhancement | User Wallet + Admin E2E + schema rewrite | ✅ Completed · [Report](./docs/reports/MONTH-4.md) |
| [5](./docs/roadmap/MONTH-5.md) | Expansion | Card system + platform polish + NWC Listener Lite | 🟡 In Progress |
| [6](./docs/roadmap/MONTH-6.md) | Expansion | NWC Proxy Lite + Lightning compliance + deployment | ⏳ Planned |
| [7](./docs/roadmap/MONTH-7.md) | Monetization | Subscription Manager + Nostr Chat (DMs) | ⏳ Planned |
| [8](./docs/roadmap/MONTH-8.md) | Intelligence | AI Agents (own LN address, NWC wallet, scheduled tasks) | ⏳ Planned |

All eight months are covered by the OpenSats Fifteenth Wave grant (Dec 2025 – Sep 2026). Full month-by-month detail in [ROADMAP.md](./docs/ROADMAP.md).

---

## Contributing

Contributions are welcome. Open an issue to discuss bugs, features, or roadmap items before sending a PR. See [docs/TESTING.md](./docs/TESTING.md) for the testing strategy and [CLAUDE.md](./CLAUDE.md) for repo conventions.

---

## License

[MIT](./LICENSE) © LaWallet contributors

---

<p align="center">
  <br />
  <sub>
    <a href="https://beta.lawallet.io">Demo</a> ·
    <a href="https://docs.lawallet.io">Docs</a> ·
    <a href="https://beta.lawallet.io/api-docs">API Playground</a> ·
    <a href="https://github.com/lawalletio/lawallet-nwc">GitHub</a>
  </sub>
</p>
