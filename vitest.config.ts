import { defineConfig } from 'vitest/config'
import react from 'next/dist/compiled/react'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['app/api/**/*.ts', 'lib/**/*.ts', 'hooks/**/*.ts', 'hooks/**/*.tsx'],
      exclude: [
        'node_modules',
        'tests',
        'mocks',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
        'prisma/**',
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
