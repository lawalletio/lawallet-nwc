import { defineConfig } from 'vitest/config'
import path from 'path'

// Separate config so benches never pollute the coverage/test runs.
// Run with: pnpm bench (writes bench-results/latest.json)
// Vitest 5: `benchmark.outputJson` is gone — JSON reporter includes a
// `benchmarks` field; write it via test.outputFile.json.
export default defineConfig({
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    reporters: ['default', 'json'],
    outputFile: {
      json: './bench-results/latest.json'
    },
    benchmark: {
      include: ['bench/**/*.bench.ts']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
})
