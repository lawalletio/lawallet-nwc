import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// NOTE: `env('DATABASE_URL')` from `prisma/config` throws at config-load
// time when the variable is missing, which breaks `prisma generate` in
// environments that legitimately don't have DB access (CI install step,
// fresh clones without .env). Generate only needs the schema; the real
// URL is resolved from the env at runtime via the schema's own
// `env("DATABASE_URL")` binding, so falling back to a placeholder here
// keeps generate working without masking a real misconfiguration.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://placeholder:placeholder@localhost:5432/placeholder'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: DATABASE_URL
  }
})
