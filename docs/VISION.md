# Vision: Lightning Addresses for Everyone

## The Problem

Communities, companies, and organizations want to give their members a Lightning-native identity — a lightning address on their own domain, a wallet, and a communication channel — but today's options are either custodial, proprietary, or require deep technical knowledge to deploy.

There is no open-source, self-hostable platform that lets you **connect a domain** and **instantly give everyone a lightning address, a wallet, and Nostr-powered communication** — all under your brand.

---

## The Solution

LaWallet NWC is an **open-source Lightning + Nostr CRM** for communities and companies.

Connect your domain. Deploy in minutes. Your users get:

- **A lightning address** on your domain (`alice@yourdomain.com`)
- **A wallet** powered by Nostr Wallet Connect (NWC)
- **Nostr identity** (NIP-05) unified with their lightning address
- **Communication** via encrypted Nostr DMs and broadcasts
- **NFC payments** via BoltCard integration

You get:

- **A CRM** with user management, activity tracking, and segmentation
- **Nostr-native communication** tools (DMs, broadcasts, newsletters)
- **Lightning payment infrastructure** out of the box
- **Progressive self-custody** — users bring their own wallets when ready
- **Full control** — your domain, your data, your rules

---

## Core Principles

### Lightning addresses for everyone
Every user on your platform gets a lightning address on your domain. Receive payments, zaps, and tips — instantly. No apps to install, no seeds to back up (unless they want to).

### Connect your domain, deploy instantly
Point your domain to LaWallet NWC and you're live. One-click deploy on Vercel. Docker for your server. Umbrel/Start9 for your node. Choose your path.

### CRM with Lightning and Nostr built in
Not a wallet with CRM bolted on. Not a CRM with payments bolted on. Lightning and Nostr are the foundation — user identity, payments, and communication are native from day one.

### Progressive self-custody
Users start with zero friction (alias redirect to an existing address), graduate to a courtesy NWC wallet, then bring their own NWC-compatible wallet when ready. Sovereignty is a journey, not a gate.

| Stage | Friction | What happens |
|-------|----------|-------------|
| 1. Alias/Redirect | Zero | Lightning address redirects to user's existing address |
| 2. Courtesy NWC | Low | Platform provides a temporary NWC wallet |
| 3. Own NWC Wallet | Medium | User connects Alby, Primal, or any NWC wallet |
| 4. Self-Hosted | Full sovereignty | User runs their own LaWallet NWC instance |

### 100% Open Source, FOREVER
MIT licensed. No open-core tricks. No proprietary features behind a paywall. Fork it, hack it, deploy it. The community owns this.

---

## Who is this for?

- **Bitcoin communities** that want `member@community.com` lightning addresses
- **Companies** that want to give employees or customers Lightning-native identity
- **Events and conferences** that need instant onboarding with NFC cards and zaps
- **Nostr communities** that want unified identity (NIP-05 + lightning address)
- **Bitcoin circular economies** that need a merchant + user directory with payments
- **Educators and organizations** that want to onboard people to Lightning with zero friction

---

## Architecture

Three independent services, no shared databases:

| Service | Role |
|---------|------|
| **lawallet-web** | Next.js app — frontend, REST API, address resolution, dashboards, wallet |
| **lawallet-listener** | NWC Payment Listener — monitors relays, dispatches webhooks |
| **lawallet-nwc-proxy** | Courtesy NWC Proxy — provisions temporary wallets from providers |

Deploy all three, or just `lawallet-web` to start. Each service scales independently.

---

## Deployment Options

| Option | Best for | Setup time |
|--------|----------|-----------|
| **Vercel** | Communities that want instant deploy | 2 minutes |
| **Docker** | Servers and VPS | 5 minutes |
| **Umbrel / Start9** | Node runners | 5 minutes |
| **Manual** | Full control | 15 minutes |

---

## Roadmap

### Foundation (Months 1–6, Grant Period)

- Backend infrastructure, testing, error handling, auth, security
- CI/CD, Client SDK, React Hooks
- Admin Dashboard (user management, activity monitor, logs)
- User Dashboard (profile, NWC management, preferences)
- Courtesy NWC Proxy service
- NWC Payment Listener service
- Full LUD-16/21/22 compliance, NIP-57 zaps
- Documentation, deployment configurations (Vercel, Docker, Umbrel)

### CRM + Communications (Post-Grant)

- Payment history and frequency tracking per user
- Onboarding stage tracking and user segmentation
- **Nostr DMs** to users (NIP-04/NIP-17/NIP-44 encrypted)
- **Broadcast messages** to user segments via Nostr
- **Newsletter-style long-form posts** (kind:30023) published to relays
- Notification system for payment events and platform updates
- Inbox management for admin

### AI Integration (Future)

- Smart message drafting with AI assistance
- Message personalization based on user profile and payment history
- Auto-responses to common user inquiries via Nostr DM
- User behavior analysis, churn prediction, segment recommendations
- Natural language search across users, payments, and communications

### Plugins (Community)

- **Events** — event management with check-in via QR/NFC, badge issuance
- **Badges** — Nostr badges (NIP-58) for attendance, achievements, tiers
- **Commerce** — merchant directory with badge-based discounts

---

## Open Standards

Every piece of the platform is built on open, interoperable protocols:

| Protocol | Usage |
|----------|-------|
| NIP-47 (NWC) | Wallet Connect — payment backend |
| NIP-05 | Nostr identity verification |
| NIP-07 / NIP-46 | Browser extension and remote signing |
| NIP-57 | Nostr zaps |
| NIP-04 / NIP-17 / NIP-44 | Encrypted DMs and communication |
| LUD-16 | Lightning Address (LNURL-pay) |
| LUD-21 | Payment verification |
| LUD-22 | Webhooks |
| BoltCard / NTAG424 | NFC tap-to-pay cards |

No vendor lock-in. No proprietary protocols. Interoperability or death.

---

## Funded by

OpenSats — Fifteenth Wave (December 2025). 6-month development grant for testing, security, SDK, dashboards, and deployment infrastructure.
