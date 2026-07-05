import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: `prisma migrate deploy` resolves its connection from the
 * schema's `env("DATABASE_URL")` binding (process.env), NOT from the
 * `datasource.url` value passed to defineConfig (which Prisma 6.x drops
 * from the returned config entirely). The config's `.env.local` override
 * therefore used to clobber the E2E provisioner's DATABASE_URL and
 * silently migrate the dev database. The config must write
 * E2E_DATABASE_URL back into process.env.DATABASE_URL.
 */
describe('prisma.config.ts E2E_DATABASE_URL precedence', () => {
  const E2E_URL = 'postgresql://e2e:e2e@localhost:59999/lawallet_test_e2e'
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.resetModules()
    savedEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('writes E2E_DATABASE_URL into process.env.DATABASE_URL so the schema env binding sees it', async () => {
    process.env.E2E_DATABASE_URL = E2E_URL
    process.env.DATABASE_URL = 'postgresql://dev:dev@localhost:5432/dev_db'

    await import('@/prisma.config')

    // migrate deploy reads process.env.DATABASE_URL — it must carry the E2E
    // URL even though .env.local is loaded with override enabled.
    expect(process.env.DATABASE_URL).toBe(E2E_URL)
  })

  it('does not touch DATABASE_URL resolution when E2E_DATABASE_URL is unset', async () => {
    delete process.env.E2E_DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://dev:dev@localhost:5432/dev_db'

    await import('@/prisma.config')

    // .env.local (when present) may legitimately override, but the result
    // must never be the E2E URL and must remain a defined connection string.
    expect(process.env.DATABASE_URL).toBeDefined()
    expect(process.env.DATABASE_URL).not.toBe(E2E_URL)
  })
})
