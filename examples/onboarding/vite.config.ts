import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The repo pins esbuild to a version that refuses to lower modern syntax
// (destructuring in nostr-tools / @noble / qrcode.react) to Vite's default
// safari14-era targets. An example app only needs current browsers — set the
// target for both dep pre-bundling (dev) and the production build.
const TARGET = 'es2022'

export default defineConfig({
  plugins: [react()],
  build: { target: TARGET },
  optimizeDeps: { esbuildOptions: { target: TARGET } }
})
