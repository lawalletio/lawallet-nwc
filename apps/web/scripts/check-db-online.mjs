#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(dirname(fileURLToPath(import.meta.url)))

loadEnvFile(resolve(webDir, '.env'))
loadEnvFile(resolve(webDir, '.env.local'))

if (process.env.SKIP_DATABASE_CHECK === 'true') {
  console.warn('[db] Skipping database check because SKIP_DATABASE_CHECK=true')
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL is missing.')
  console.error('[db] Add it to apps/web/.env before starting the dev server.')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const { PrismaClient } = require('../lib/generated/prisma')
const prisma = new PrismaClient()
const databaseLabel = describeDatabaseUrl(process.env.DATABASE_URL)

try {
  await prisma.$queryRaw`SELECT 1`
  console.log(`[db] Database online: ${databaseLabel}`)
} catch (error) {
  console.error(`[db] Database offline: ${databaseLabel}`)
  console.error(`[db] ${formatError(error)}`)
  console.error('[db] Start local Postgres with: docker compose up -d postgres')
  console.error(
    '[db] Then apply migrations with: pnpm --filter @lawallet-nwc/web exec prisma migrate deploy'
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect().catch(() => {})
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return
  }

  const contents = readFileSync(path, 'utf8')

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const line = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length)
      : trimmed
    const separatorIndex = line.indexOf('=')

    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!key || process.env[key] !== undefined) {
      continue
    }

    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const inlineCommentIndex = value.search(/\s+#/)
      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trim()
      }
    }

    process.env[key] = value.replace(/\\n/g, '\n')
  }
}

function describeDatabaseUrl(value) {
  try {
    const url = new URL(value)
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname
    const path = url.pathname || ''

    return `${url.protocol}//${host}${path}`
  } catch {
    return 'invalid DATABASE_URL'
  }
}

function formatError(error) {
  if (!(error instanceof Error)) {
    return String(error)
  }

  return error.message.replace(/\s+/g, ' ').trim()
}
