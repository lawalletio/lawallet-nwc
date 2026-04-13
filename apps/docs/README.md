# LaWallet NWC Documentation

Interactive documentation for [LaWallet NWC](https://github.com/lawalletio/lawallet-nwc) — the open-source Lightning Address platform with Nostr Wallet Connect.

Built with [Fumadocs](https://fumadocs.dev) + [Sandpack](https://sandpack.codesandbox.io/) for live, editable code examples.

## Quick Start

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- **Fumadocs** v16 — MDX documentation framework with search, sidebar, and ToC
- **Sandpack** v2 — In-browser code editor and preview for interactive examples
- **Next.js** 16 — React framework with App Router and static generation
- **Tailwind CSS** v4 — Utility-first styling
- **bun** — Package manager and runtime

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── (home)/             # Landing page
│   ├── docs/               # Documentation layout and pages
│   └── api/search/         # Full-text search endpoint
├── components/             # Sandpack wrappers and utilities
├── content/docs/           # MDX documentation files
│   ├── getting-started/    # Quick start, vision, onboarding, Docker
│   ├── architecture/       # System design, service docs
│   ├── guides/             # SDK, JWT auth, testing
│   ├── api-reference/      # REST API docs
│   ├── plugins/            # Events, Badges, Commerce proposals
│   ├── integrations/       # WordPress
│   ├── roadmap/            # Month 1-6 plans
│   ├── changelogs/         # Monthly changelogs
│   └── reports/            # OpenSats grant reports
├── lib/                    # Source loader and layout config
├── source.config.ts        # Fumadocs MDX collection config
└── mdx-components.tsx      # MDX component registry
```

## Adding Documentation

Create an `.mdx` file in `content/docs/`:

```mdx
---
title: My Page
description: Short description for search and meta tags.
---

## Content here

Regular markdown with code blocks, tables, and more.
```

Update the corresponding `meta.json` to include the page in the sidebar.

## Adding Interactive Examples

Three Sandpack components are available in any MDX file:

```mdx
{/* Full editor + preview */}
<SandpackLive
  template="react-ts"
  files={{
    "/App.tsx": `export default function App() {
  return <h1>Hello</h1>;
}`,
  }}
/>

{/* Simple embed */}
<SandpackExample template="react-ts" />

{/* Code-only with console */}
<SandpackCodeOnly
  template="vanilla-ts"
  files={{
    "/index.ts": `console.log("Hello");`,
  }}
/>
```

## Building

```bash
bun run build
```

Generates 32 static pages ready for deployment on Vercel, Netlify, or any static host.

## License

MIT
