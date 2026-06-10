import { defineConfig, devices } from '@playwright/test'
import { resolveE2eDatabaseUrl, E2E_JWT_SECRET, E2E_PORT, E2E_BASE_URL } from './e2e/env'

const allBrowsers = !!process.env.PW_ALL_BROWSERS

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'e2e-results/junit.xml' }]
      ]
    : [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 }
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Heavier browsers are opt-in: PW_ALL_BROWSERS=1 pnpm e2e
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } }
        ]
      : [])
  ],
  webServer: {
    command: `pnpm exec next dev --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/health`,
    // Never reuse a foreign server: it would run with the wrong database and
    // JWT secret. The explicit env below is the contract the fixtures rely on.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: resolveE2eDatabaseUrl(),
      JWT_SECRET: E2E_JWT_SECRET,
      NODE_ENV: 'development',
      RATE_LIMIT_ENABLED: 'false',
      AUTO_GENERATE_ALBY_SUBACCOUNTS: 'false',
      MAINTENANCE_MODE: 'false',
      NEXT_PUBLIC_LAWALLET_LANDING_URL: '/admin',
      LOG_LEVEL: 'warn'
    }
  }
})
