import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared E2E environment resolution, imported by both playwright.config.ts
 * and the global setup so they can never disagree.
 *
 * The E2E suite always runs against a DEDICATED database: the checkout's
 * configured DATABASE_URL with an `_e2e` suffix on the database name. Dev
 * data is never touched. Override with E2E_DATABASE_URL to point somewhere
 * else entirely (CI does this implicitly by exporting DATABASE_URL for the
 * postgres service — the suffix still applies, deploy creates the DB).
 */

const webRoot = path.resolve(__dirname, '..')

function parseEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {}

  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=')
        const key = line.slice(0, index)
        const value = line
          .slice(index + 1)
          .trim()
          .replace(/^"(.*)"$/, '$1')
          .replace(/^'(.*)'$/, '$1')
        return [key, value]
      })
  )
}

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const local = parseEnvFile(path.join(webRoot, '.env.local'))
  if (local.DATABASE_URL) return local.DATABASE_URL

  const dotenv = parseEnvFile(path.join(webRoot, '.env'))
  if (dotenv.DATABASE_URL) return dotenv.DATABASE_URL

  throw new Error(
    'E2E: no DATABASE_URL found. Run `pnpm dev:setup` from the repo root ' +
      'first (it writes apps/web/.env.local), or export DATABASE_URL.'
  )
}

export function resolveE2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL

  const url = new URL(resolveBaseDatabaseUrl())
  if (!url.pathname.endsWith('_e2e')) url.pathname = `${url.pathname}_e2e`
  return url.toString()
}

/** Fixed secret shared by the webServer and the token-minting fixture. */
export const E2E_JWT_SECRET = 'e2e-only-jwt-secret-at-least-32-characters'

export const E2E_PORT = Number(process.env.E2E_PORT || 3100)

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
