import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/* ── Toolbox items ────────────────────────────────────────── */

const toolbox = [
  {
    title: "SDK & React Hooks",
    description: "11 hooks, TypeScript client, caching & type safety",
    href: "/docs/guides/sdk",
    icon: "package",
    badge: "TypeScript",
    badgeColor: "#3178C6",
  },
  {
    title: "REST API",
    description: "Full endpoint reference for address, wallet & identity",
    href: "/docs/api-reference",
    icon: "terminal",
    badge: "Reference",
    badgeColor: "#F5A623",
  },
  {
    title: "JWT Authentication",
    description: "NIP-98 to JWT exchange, token lifecycle & protected routes",
    href: "/docs/guides/jwt-authentication",
    icon: "key",
    badge: "Security",
    badgeColor: "#E53935",
  },
  {
    title: "WordPress Plugin",
    description: "Lightning payments & NWC checkout for WooCommerce",
    href: "/docs/integrations/wordpress",
    icon: "plug",
    badge: "Integration",
    badgeColor: "#26A69A",
  },
  {
    title: "Docker Deploy",
    description: "One-command production deployment with docker compose",
    href: "/docs/getting-started/docker",
    icon: "container",
    badge: "DevOps",
    badgeColor: "#4DB6AC",
  },
  {
    title: "Testing Guide",
    description: "End-to-end testing patterns for NWC flows",
    href: "/docs/guides/testing",
    icon: "flask",
    badge: "QA",
    badgeColor: "#FFD580",
  },
  {
    title: "Events Plugin",
    description: "Ticketing & event management with Lightning payments",
    href: "/docs/plugins/events",
    icon: "calendar",
    badge: "Plugin",
    badgeColor: "#9C27B0",
  },
  {
    title: "Commerce Plugin",
    description: "Point-of-sale, invoicing & merchant tools",
    href: "/docs/plugins/commerce",
    icon: "cart",
    badge: "Plugin",
    badgeColor: "#9C27B0",
  },
];

/* ── Features ─────────────────────────────────────────────── */

const features = [
  {
    title: "Lightning Addresses",
    description:
      "Give your users lightning addresses under your domain. LUD-16 compliant, with NIP-05 Nostr identity.",
    icon: "zap",
    color: "gold",
  },
  {
    title: "Progressive Self-Custody",
    description:
      "Start with a simple alias, graduate to courtesy NWC, then bring your own wallet. Four stages of sovereignty.",
    icon: "shield",
    color: "teal",
  },
  {
    title: "Nostr Wallet Connect",
    description:
      "NIP-47 native. Connect any NWC-compatible wallet as your payment backend.",
    icon: "link",
    color: "gold",
  },
  {
    title: "Self-Hostable",
    description:
      "Deploy on Vercel, Docker, Umbrel, or Start9. Three independent services, zero shared infrastructure.",
    icon: "server",
    color: "teal",
  },
  {
    title: "SDK & React Hooks",
    description:
      "TypeScript client SDK and 11 React hooks with caching, loading states, and type safety.",
    icon: "code",
    color: "gold",
  },
  {
    title: "100% Open Source",
    description:
      "MIT licensed. Funded by OpenSats. Built for communities, companies, and circular economies.",
    icon: "heart",
    color: "coral",
  },
];

const protocols = [
  { name: "NIP-47", label: "Nostr Wallet Connect" },
  { name: "NIP-05", label: "Nostr Identity" },
  { name: "NIP-57", label: "Zaps" },
  { name: "LUD-16", label: "Lightning Address" },
  { name: "LUD-21", label: "Payment Verification" },
  { name: "LUD-22", label: "Webhooks" },
];

/* ── Icons ────────────────────────────────────────────────── */

const svgProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons: Record<string, ReactNode> = {
  zap: (
    <svg {...svgProps}>
      <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' />
    </svg>
  ),
  shield: (
    <svg {...svgProps}>
      <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
    </svg>
  ),
  link: (
    <svg {...svgProps}>
      <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
      <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
    </svg>
  ),
  server: (
    <svg {...svgProps}>
      <rect x='2' y='2' width='20' height='8' rx='2' />
      <rect x='2' y='14' width='20' height='8' rx='2' />
      <circle cx='6' cy='6' r='1' />
      <circle cx='6' cy='18' r='1' />
    </svg>
  ),
  code: (
    <svg {...svgProps}>
      <polyline points='16 18 22 12 16 6' />
      <polyline points='8 6 2 12 8 18' />
    </svg>
  ),
  heart: (
    <svg {...svgProps}>
      <path d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' />
    </svg>
  ),
  package: (
    <svg {...svgProps}>
      <path d='M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
      <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
      <line x1='12' y1='22.08' x2='12' y2='12' />
    </svg>
  ),
  terminal: (
    <svg {...svgProps}>
      <polyline points='4 17 10 11 4 5' />
      <line x1='12' y1='19' x2='20' y2='19' />
    </svg>
  ),
  key: (
    <svg {...svgProps}>
      <path d='M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' />
    </svg>
  ),
  plug: (
    <svg {...svgProps}>
      <path d='M12 22v-5' />
      <path d='M9 8V2' />
      <path d='M15 8V2' />
      <path d='M18 8v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z' />
    </svg>
  ),
  container: (
    <svg {...svgProps}>
      <rect x='2' y='7' width='20' height='14' rx='2' />
      <path d='M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3' />
      <line x1='2' y1='12' x2='22' y2='12' />
    </svg>
  ),
  flask: (
    <svg {...svgProps}>
      <path d='M9 3h6' />
      <path d='M10 3v7.4a2 2 0 0 1-.6 1.4L4 17.2a2 2 0 0 0 1.4 3.4h13.2a2 2 0 0 0 1.4-3.4l-5.4-5.4a2 2 0 0 1-.6-1.4V3' />
    </svg>
  ),
  calendar: (
    <svg {...svgProps}>
      <rect x='3' y='4' width='18' height='18' rx='2' />
      <line x1='16' y1='2' x2='16' y2='6' />
      <line x1='8' y1='2' x2='8' y2='6' />
      <line x1='3' y1='10' x2='21' y2='10' />
    </svg>
  ),
  cart: (
    <svg {...svgProps}>
      <circle cx='8' cy='21' r='1' />
      <circle cx='19' cy='21' r='1' />
      <path d='M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12' />
    </svg>
  ),
  wrench: (
    <svg {...svgProps}>
      <path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' />
    </svg>
  ),
};

const iconColors: Record<string, string> = {
  gold: "text-[#F5A623]",
  teal: "text-[#26A69A]",
  coral: "text-[#E53935]",
};

const iconBgColors: Record<string, string> = {
  gold: "bg-[#F5A623]/10",
  teal: "bg-[#26A69A]/10",
  coral: "bg-[#E53935]/10",
};

/* ── Page ─────────────────────────────────────────────────── */

export default function HomePage() {
  return (
    <main className='flex flex-1 flex-col relative overflow-hidden'>
      {/* ── Animated dev background ──────────────────────────── */}
      <div className='fixed inset-0 pointer-events-none -z-10' aria-hidden>
        {/* Grid */}
        <div className='absolute inset-0 grid-pattern' />
        {/* Large blurred orbs */}
        <div className='absolute top-[10%] left-[15%] w-[500px] h-[500px] bg-[#F5A623]/[0.04] rounded-full blur-[150px] animate-[float_20s_ease-in-out_infinite]' />
        <div className='absolute top-[40%] right-[10%] w-[400px] h-[400px] bg-[#26A69A]/[0.04] rounded-full blur-[130px] animate-[float_25s_ease-in-out_infinite_3s]' />
        <div className='absolute bottom-[10%] left-[30%] w-[350px] h-[350px] bg-[#E53935]/[0.03] rounded-full blur-[120px] animate-[float_22s_ease-in-out_infinite_6s]' />
        {/* Scan lines */}
        <div className='absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(245,166,35,0.01)_2px,rgba(245,166,35,0.01)_4px)]' />
      </div>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className='relative flex flex-col items-center justify-center text-center px-4 pt-24 pb-20'>
        <div className='inline-flex items-center gap-2 rounded-full border border-[#F5A623]/20 bg-[#F5A623]/5 px-4 py-1.5 text-sm text-[#FFD580] mb-8 backdrop-blur-sm'>
          Funded by OpenSats &middot; Fifteenth Wave
        </div>

        <Image
          src='/logos/lawallet.svg'
          alt='LaWallet'
          width={280}
          height={52}
          className='mb-4'
          priority
        />

        <h1 className='text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight mb-2 text-gradient-gold'>
          DOCS
        </h1>

        <p className='text-fd-muted-foreground text-lg sm:text-xl max-w-2xl mb-10 leading-relaxed'>
          Discover the{" "}
          <span className='text-[#FFD580] font-semibold'>LaWallet API</span> —
          connect backend services with intuitive SDK tools for modern apps.
        </p>

        <div className='flex flex-wrap gap-4 justify-center'>
          <Link
            href='/docs'
            className='inline-flex items-center justify-center rounded-lg bg-[#F5A623] px-8 py-3 text-sm font-semibold text-[#0A0A0F] shadow-lg shadow-[#F5A623]/20 transition-all hover:bg-[#FFD580] hover:shadow-xl hover:shadow-[#F5A623]/30'
          >
            Get Started
          </Link>
          <Link
            href='/docs/guides/sdk'
            className='inline-flex items-center justify-center rounded-lg border border-[#26A69A]/30 px-8 py-3 text-sm font-medium text-[#26A69A] transition-all hover:bg-[#26A69A]/10 hover:border-[#26A69A]/50'
          >
            SDK Reference
          </Link>
          <Link
            href='https://github.com/lawalletio/lawallet-nwc'
            className='inline-flex items-center justify-center rounded-lg border border-fd-border px-8 py-3 text-sm font-medium transition-all hover:bg-fd-accent hover:text-fd-accent-foreground'
          >
            GitHub
          </Link>
        </div>
      </section>

      {/* ── Protocol badges ──────────────────────────────────── */}
      <section className='flex flex-wrap items-center justify-center gap-3 px-4 pb-20'>
        {protocols.map((p) => (
          <span
            key={p.name}
            className='inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-card/80 backdrop-blur-sm px-3 py-1.5 text-xs font-mono transition-colors hover:border-[#F5A623]/30'
          >
            <span className='font-semibold text-[#F5A623]'>{p.name}</span>
            <span className='text-fd-muted-foreground'>{p.label}</span>
          </span>
        ))}
      </section>

      {/* ── Developer Toolbox ────────────────────────────────── */}
      <section className='relative max-w-6xl mx-auto px-4 pb-28 w-full'>
        {/* Section glow */}
        <div className='absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[200px] bg-[#F5A623]/[0.03] rounded-full blur-[100px]' />

        <div className='text-center mb-12'>
          <div className='inline-flex items-center gap-3 mb-4'>
            <div className='h-px w-12 bg-gradient-to-r from-transparent to-[#F5A623]/40' />
            <span className='inline-flex items-center gap-2 text-[#F5A623] text-sm font-mono uppercase tracking-widest'>
              {icons.wrench}
              Developer Toolbox
            </span>
            <div className='h-px w-12 bg-gradient-to-l from-transparent to-[#F5A623]/40' />
          </div>
          <h2 className='text-3xl sm:text-4xl font-bold mb-3'>
            Everything you need to{" "}
            <span className='text-gradient-brand'>build</span>
          </h2>
          <p className='text-fd-muted-foreground max-w-xl mx-auto'>
            SDK, API reference, deployment guides, plugins, and integrations.
            Jump straight into what you need.
          </p>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
          {toolbox.map((tool) => (
            <Link
              key={tool.title}
              href={tool.href}
              className='group relative rounded-xl border border-fd-border bg-fd-card/80 backdrop-blur-sm p-5 transition-all duration-300 hover:border-[#F5A623]/30 hover:shadow-lg hover:shadow-[#F5A623]/5 hover:-translate-y-0.5'
            >
              {/* Top row: icon + badge */}
              <div className='flex items-start justify-between mb-3'>
                <div className='inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#F5A623]/10 text-[#F5A623] group-hover:bg-[#F5A623]/20 transition-colors'>
                  {icons[tool.icon]}
                </div>
                <span
                  className='inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider border'
                  style={{
                    color: tool.badgeColor,
                    borderColor: `${tool.badgeColor}30`,
                    backgroundColor: `${tool.badgeColor}10`,
                  }}
                >
                  {tool.badge}
                </span>
              </div>
              <h3 className='font-semibold text-sm mb-1 group-hover:text-[#F5A623] transition-colors'>
                {tool.title}
              </h3>
              <p className='text-xs text-fd-muted-foreground leading-relaxed'>
                {tool.description}
              </p>
              {/* Hover arrow */}
              <div className='absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0 text-[#F5A623]'>
                <svg
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <line x1='5' y1='12' x2='19' y2='12' />
                  <polyline points='12 5 19 12 12 19' />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────── */}
      <section className='max-w-5xl mx-auto px-4 pb-24'>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
          {features.map((f) => (
            <div
              key={f.title}
              className='group rounded-xl border border-fd-border bg-fd-card/80 backdrop-blur-sm p-6 transition-all hover:border-[#F5A623]/30 hover:shadow-lg hover:shadow-[#F5A623]/5'
            >
              <div
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${iconBgColors[f.color]} ${iconColors[f.color]} mb-4`}
              >
                {icons[f.icon]}
              </div>
              <h3 className='font-semibold mb-2'>{f.title}</h3>
              <p className='text-sm text-fd-muted-foreground leading-relaxed'>
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Architecture overview ────────────────────────────── */}
      <section className='max-w-4xl mx-auto px-4 pb-24'>
        <h2 className='text-2xl font-bold text-center mb-2'>
          Two Services + lncurl
        </h2>
        <p className='text-center text-sm text-fd-muted-foreground mb-8'>
          No shared database. No shared filesystem. Independent services +
          external courtesy NWC via lncurl.
        </p>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          {[
            {
              name: "lawallet-web",
              port: "3000",
              desc: "Next.js app serving frontend, API, dashboards, and address resolution.",
              color: "#F5A623",
            },
            {
              name: "lawallet-listener",
              port: "3001/3002",
              desc: "Monitors NWC relays for payments, dispatches LUD-22 webhooks.",
              color: "#26A69A",
            },
            {
              name: "lncurl",
              port: "external",
              desc: "Agent-first courtesy NWC wallets via lncurl.lol, powered by Alby Hub.",
              color: "#4DB6AC",
            },
          ].map((s) => (
            <div
              key={s.name}
              className='rounded-lg border border-fd-border bg-fd-card/80 backdrop-blur-sm p-5 transition-all hover:border-[color:var(--hover-color)] hover:shadow-md'
              style={{ "--hover-color": `${s.color}40` } as React.CSSProperties}
            >
              <div
                className='font-mono text-sm font-semibold mb-1'
                style={{ color: s.color }}
              >
                {s.name}
              </div>
              <div className='text-xs text-fd-muted-foreground font-mono mb-3'>
                {s.port === "external" ? "External service" : `Port ${s.port}`}
              </div>
              <p className='text-sm text-fd-muted-foreground'>{s.desc}</p>
            </div>
          ))}
        </div>
        <p className='text-center text-sm text-fd-muted-foreground mt-6'>
          <Link
            href='/docs/architecture'
            className='text-[#F5A623] hover:text-[#FFD580] hover:underline transition-colors'
          >
            Learn more about the architecture
          </Link>
        </p>
      </section>
    </main>
  );
}
