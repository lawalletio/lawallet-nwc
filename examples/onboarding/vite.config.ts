import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The repo pins esbuild to a version that refuses to lower modern syntax
// (destructuring in nostr-tools / @noble / qrcode.react) to Vite's default
// safari14-era targets. An example app only needs current browsers — set the
// target for both dep pre-bundling (dev) and the production build.
const TARGET = 'es2022'

/** Public instance, used when this example is run outside the monorepo. */
const PUBLIC_ENDPOINT = 'https://beta.lawallet.io'

/**
 * Zero-config endpoint resolution, so `pnpm dev` just works:
 *
 *   1. VITE_LAWALLET_ENDPOINT, when the developer set one.
 *   2. This monorepo's own web instance — `pnpm start:dev-server` writes the
 *      port it serves on into apps/web/.env.local.
 *   3. The public instance.
 */
function resolveDefaultEndpoint(): string {
  if (process.env.VITE_LAWALLET_ENDPOINT) {
    return process.env.VITE_LAWALLET_ENDPOINT.replace(/\/+$/, '')
  }

  const envLocal = fileURLToPath(
    new URL('../../apps/web/.env.local', import.meta.url)
  )
  if (existsSync(envLocal)) {
    const port = readFileSync(envLocal, 'utf8').match(
      /^PORT\s*=\s*"?(\d+)"?/m
    )?.[1]
    if (port) return `http://localhost:${port}`
  }

  return PUBLIC_ENDPOINT
}

export default defineConfig({
  plugins: [react()],
  build: { target: TARGET },
  optimizeDeps: { esbuildOptions: { target: TARGET } },
  define: {
    'import.meta.env.VITE_DEFAULT_ENDPOINT': JSON.stringify(
      resolveDefaultEndpoint()
    )
  }
})
