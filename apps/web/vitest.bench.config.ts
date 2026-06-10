import { defineConfig } from 'vitest/config'
import path from 'path'

// Separate config so benches never pollute the coverage/test runs.
// Run with: pnpm bench (writes bench-results/latest.json)
export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    benchmark: {
      outputJson: './bench-results/latest.json'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
})
