#!/usr/bin/env node

// Provisions the dedicated E2E database BEFORE Playwright starts, so the
// webServer health check (/api/health, which pings the DB) can pass.
// Keep the URL derivation in sync with e2e/env.ts.
//
// 1. `migrate deploy` — creates the database if missing + applies migrations
// 2. truncate all tables — clean slate (the repo seed is not idempotent)
// 3. `pnpm run seed`  — mock-based, deterministic fixtures
//
// Safety interlock: this script refuses to touch any database whose name
// does not end in `_e2e`, so it is structurally incapable of clearing dev
// or production data.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

function parseEnvFile(file) {
  if (!existsSync(file)) return {}

  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=')
        const value = line
          .slice(index + 1)
          .trim()
          .replace(/^"(.*)"$/, '$1')
          .replace(/^'(.*)'$/, '$1')
        return [line.slice(0, index), value]
      })
  )
}

function resolveE2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL

  const base =
    process.env.DATABASE_URL ||
    parseEnvFile(path.join(webRoot, '.env.local')).DATABASE_URL ||
    parseEnvFile(path.join(webRoot, '.env')).DATABASE_URL

  if (!base) {
    console.error(
      'E2E: no DATABASE_URL found. Run `pnpm dev:setup` from the repo root ' +
        'first, or export DATABASE_URL.'
    )
    process.exit(1)
  }

  const url = new URL(base)
  if (!url.pathname.endsWith('_e2e')) url.pathname = `${url.pathname}_e2e`
  return url.toString()
}

const databaseUrl = resolveE2eDatabaseUrl()

if (!new URL(databaseUrl).pathname.endsWith('_e2e')) {
  console.error(
    `E2E: refusing to provision "${databaseUrl}" — database name must end ` +
      'in _e2e. This script clears the database it targets.'
  )
  process.exit(1)
}

const env = { ...process.env, DATABASE_URL: databaseUrl }
const run = cmd => execSync(cmd, { cwd: webRoot, env, stdio: 'inherit' })

async function truncateAllTables() {
  const { PrismaClient } = require(
    path.join(webRoot, 'lib', 'generated', 'prisma', 'index.js')
  )
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

  try {
    const tables = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`
    )

    if (tables.length > 0) {
      const list = tables.map(t => `"public"."${t.tablename}"`).join(', ')
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

console.log(`E2E database: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)
run('pnpm exec prisma migrate deploy')
await truncateAllTables()
run('pnpm run seed')
