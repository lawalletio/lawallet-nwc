// Dev-only: hosts allowed to reach the dev server's internal resources
// (HMR, RSC, server actions). Next 16 blocks these from any non-localhost
// origin by default, which makes the app behave differently through a tunnel
// than on localhost. Extend the list with the comma-separated
// ALLOWED_DEV_ORIGINS env var (e.g. in .env.local). No effect on production.
const allowedDevOrigins = [
  'agustin.masize.com',
  // cloudflared quick tunnels (random *.trycloudflare.com per run).
  '*.trycloudflare.com',
  'someone-taxes-powell-fans.trycloudflare.com',
  ...(process.env.ALLOWED_DEV_ORIGINS?.split(',')
    .map(s => s.trim())
    .filter(Boolean) ?? [])
]

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { withSentryConfig } from '@sentry/nextjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  output: 'standalone',
  // Pin the file-tracing root to the monorepo root (apps/web -> ../..).
  // Without this Next infers the root from the nearest lockfile, which in a
  // nested git worktree resolves to the OUTER repo and bloats the standalone
  // path. Pinning it keeps the standalone layout deterministic (apps/web/
  // server.js) so the Dockerfile COPY stays correct, and silences the
  // "inferred workspace root" warning.
  outputFileTracingRoot: join(__dirname, '../..'),
  allowedDevOrigins,
  async redirects() {
    return [
      // `/wallet/nostr-login` was the signup chooser's path from v0.10.0
      // through v2.0.0 before it was renamed to `/wallet/signup`. It shipped
      // in released builds, so bookmarks and external links to it exist;
      // 308 keeps them working instead of 404ing.
      {
        source: '/wallet/nostr-login',
        destination: '/wallet/signup',
        permanent: true
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/.well-known/lnurlp/:username',
        destination: '/api/lud16/:username'
      }
    ]
  }
}

// Sourcemap upload only activates when SENTRY_AUTH_TOKEN is present in the
// build env; without it this wrapper is inert at runtime.
export default withSentryConfig(nextConfig, {
  org: 'la-crypta',
  project: 'lawallet-web',
  silent: !process.env.CI,
  disableLogger: true,
  // Records each build as a deploy against its release (Sentry ▸ Releases ▸
  // Deploys), so a spike can be read against "what shipped when". Only runs
  // when SENTRY_AUTH_TOKEN is present — a no-op for forks and self-hosters.
  release: {
    deploy: {
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      url: process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    }
  }
})
