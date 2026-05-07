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
    title: "API Playground",
    description: "Interactive REST reference with NIP-07 / NIP-98 signing",
    href: "https://beta.lawallet.io/api-docs",
    icon: "terminal",
    badge: "Playground",
    badgeColor: "#F5A623",
  },
  {
    title: "Docker · Umbrel · Start9 Deploy",
    description: "Self-host on Docker, Umbrel, or Start9 with one-command deployment",
    href: "/docs/deploy",
    icon: "container",
    badge: "DevOps",
    badgeColor: "#4DB6AC",
  },
  {
    title: "Create Plugins",
    description: "Build ticketing, commerce, and merchant tools on top of LaWallet",
    href: "/docs/plugins",
    icon: "plug",
    badge: "Plugin",
    badgeColor: "#9C27B0",
  },
];

/* ── Deploy options ───────────────────────────────────────── */

const deployOptions = [
  {
    title: "Vercel",
    description: "Free one-click deploy. Production-ready in minutes.",
    href: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flawalletio%2Flawallet-nwc&root-directory=apps%2Fweb",
    external: true,
    icon: "vercel",
  },
  {
    title: "Local Deploy",
    description: "Run the TypeScript build on your own machine for development.",
    href: "/docs/deploy/local",
    external: false,
    icon: "localTerminal",
  },
  {
    title: "Docker",
    description: "Containerized deploy with docker compose for any VPS or server.",
    href: "/docs/deploy/docker",
    external: false,
    icon: "dockerWhale",
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

const deployIcons: Record<string, ReactNode> = {
  vercel: (
    <svg width='100%' height='100%' viewBox='0 0 24 24' fill='currentColor'>
      <path d='M12 2L22 20H2L12 2z' />
    </svg>
  ),
  localTerminal: (
    <svg
      width='100%'
      height='100%'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <rect x='2' y='4' width='20' height='16' rx='2' />
      <polyline points='6 10 10 13 6 16' />
      <line x1='12' y1='17' x2='17' y2='17' />
    </svg>
  ),
  dockerWhale: (
    <svg width='100%' height='100%' viewBox='0 0 24 24' fill='currentColor'>
      <path d='M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z' />
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
            href='https://beta.lawallet.io/api-docs'
            className='inline-flex items-center justify-center rounded-lg border border-[#26A69A]/30 px-8 py-3 text-sm font-medium text-[#26A69A] transition-all hover:bg-[#26A69A]/10 hover:border-[#26A69A]/50'
          >
            API Playground
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

      {/* ── Deploy options grid ──────────────────────────────── */}
      <section className='max-w-6xl mx-auto px-4 pb-24'>
        <div className='text-center mb-10'>
          <h2 className='text-3xl md:text-4xl font-bold mb-3'>
            Deploy in one click
          </h2>
          <p className='text-base text-fd-muted-foreground'>
            Three ways to ship LaWallet NWC to production.
          </p>
        </div>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          {deployOptions.map((opt) => (
            <Link
              key={opt.title}
              href={opt.href}
              {...(opt.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className='group relative flex flex-col items-center justify-center rounded-2xl border border-fd-border bg-fd-card/80 backdrop-blur-sm p-12 min-h-[360px] transition-all hover:border-[#F5A623]/40 hover:bg-fd-card hover:-translate-y-1 hover:shadow-xl hover:shadow-[#F5A623]/10 no-underline'
            >
              <div className='flex items-center justify-center w-32 h-32 mb-6 text-fd-foreground transition-transform group-hover:scale-110'>
                {deployIcons[opt.icon]}
              </div>
              <h3 className='text-xl font-semibold mb-2 text-center'>
                {opt.title}
              </h3>
              <p className='text-sm text-fd-muted-foreground leading-relaxed text-center max-w-[260px]'>
                {opt.description}
              </p>
            </Link>
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
