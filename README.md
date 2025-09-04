![LaWallet Logo](/public/logos/lawallet.png)

# NWC version

> 🚨 Project in pre-alpha, do not use real data. Expect breaking changes.

LaWallet NWC is an open-source platform for creating, managing and serving Boltcard payments. Users can connect their own Nostr Wallet Connect (NWC) and configure lightning addresses to enable seamless NFC card payments. The platform provides a complete solution for managing Boltcard infrastructure while letting users maintain control of their payment channels.

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

### Landing page

- Fully responsive
- Instructions
- Waitlist from (Sendy subscription)

## Tech Stack

- **TypeScript** 🔷 [v5.0+](https://www.typescriptlang.org/) - Typed JavaScript
- **React** ⚛️ ([Next.js](https://nextjs.org/) v13.4+) - Web framework
- **Tailwind CSS** 🎨 [v3.3+](https://tailwindcss.com/) - Utility-first CSS
- **shadcn/ui** 🎯 [v0.4+](https://ui.shadcn.com/) - UI component library
- **Prisma** 💾 [v4.16+](https://www.prisma.io/) - Database ORM
- **Alby lib** ⚡ [v1.6+](https://github.com/getAlby/js-sdk) - NWC library
- **UI**:
  - [Radix UI](https://www.radix-ui.com/) 🎨 - Headless UI primitives
  - [Lucide Icons](https://lucide.dev/) 🎯 - Icon library
  - And more...

## Open Standards

This project is built on and interoperates with the following open standards:

- **NWC** 🔑 [Nostr Wallet Connect](https://nwc.getalby.com/)
- **BoltCard** 💳 [NFC Lightning card standard](https://github.com/boltcard/boltcard)
- **LUD-16** ⚡ [Lightning Address](https://github.com/lnurl/luds/blob/luds/16.md)
- **LUD-21** 🔗 [LNURL](https://github.com/lnurl/luds/blob/luds/21.md)
- **NIP-46** 🔏 [Nostr remote signing](https://github.com/nostr-protocol/nips/blob/master/46.md)
- **NIP-07** 🔌 [Nostr browser extension API](https://github.com/nostr-protocol/nips/blob/master/07.md)

## Getting Started

1. **Install dependencies:**

Set correct node version with `nvm`

```bash
nvm use
```

Install dependencies

```bash
pnpm install
```

2. **Set up environment variables**

```bash
cp .env.example .env
```

Edit `.env.local` with your own values. More information in [ENVIRONMENT.md](./docs/ENVIRONMENT.md).

3. **Generate Prisma client and run migrations**

```bash
pnpm prisma generate
```

```bash
pnpm prisma migrate deploy
```

```bash
pnpm prisma db seed
```

4. **Run the development server:**

```bash
pnpm dev
```

5. **Open your browser:**

Visit [http://localhost:3000](http://localhost:3000) to see the app.

## Admin Dashboard

Go to admin dashboard at [http://localhost:3000/admin](http://localhost:3000/admin) to see the app.

## Wallet

Go to wallet at [http://localhost:3000/wallet](http://localhost:3000/wallet) to see user's wallet app.

## License

MIT
