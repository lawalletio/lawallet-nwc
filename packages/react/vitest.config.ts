import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Required for @testing-library/react's automatic DOM cleanup, which
    // registers itself on the global afterEach.
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
  }
})
