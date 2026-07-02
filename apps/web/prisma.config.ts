import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'

const configDir = dirname(fileURLToPath(import.meta.url))

loadEnvFile(resolve(configDir, '.env'))
loadEnvFile(resolve(configDir, '.env.local'), { override: true })

// NOTE: `env('DATABASE_URL')` from `prisma/config` throws at config-load
// time when the variable is missing, which breaks `prisma generate` in
// environments that legitimately don't have DB access (CI install step,
// fresh clones without .env). Generate only needs the schema; the real
// URL is resolved from the env at runtime via the schema's own
// `env("DATABASE_URL")` binding, so falling back to a placeholder here
// keeps generate working without masking a real misconfiguration.
// `E2E_DATABASE_URL` wins when present: the E2E provisioner targets a dedicated
// `_e2e` database, but the `.env.local` override above would otherwise clobber
// the `DATABASE_URL` it passes to `prisma migrate deploy`, silently migrating
// the dev DB instead. This mirrors the precedence in `e2e/env.ts`. No effect on
// normal dev/CI, where `E2E_DATABASE_URL` is unset.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://placeholder:placeholder@localhost:5432/placeholder'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --compiler-options \'{"module":"CommonJS"}\' prisma/seed.ts'
  },
  datasource: {
    url: DATABASE_URL
  }
})

function loadEnvFile(path: string, options: { override?: boolean } = {}) {
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
    if (!key || (!options.override && process.env[key] !== undefined)) {
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
