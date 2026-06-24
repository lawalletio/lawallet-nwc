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
  async rewrites() {
    return [
      {
        source: '/.well-known/lnurlp/:username',
        destination: '/api/lud16/:username'
      }
    ]
  }
}

export default nextConfig
