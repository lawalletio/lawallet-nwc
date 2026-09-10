import { defineConfig } from 'vitest/config'
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
      include: [
        'app/api/**/*.ts',
        'lib/**/*.ts',
        'hooks/**/*.ts',
        'hooks/**/*.tsx'
      ],
      exclude: [
        'node_modules',
        'tests',
        'mocks',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/types/**',
        'prisma/**',
        'lib/client/**'
      ],
      thresholds: {
        statements: 60,
        // Vitest 5's v8 provider counts implicit-else branches that Vitest 3
        // omitted. 70% is the new measured baseline after that remapping.
        branches: 70,
        functions: 70,
        lines: 60
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
})
