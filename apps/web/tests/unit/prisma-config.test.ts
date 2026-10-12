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

describe('prisma.config.ts DATABASE_URL_UNPOOLED', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.resetModules()
    savedEnv = { ...process.env }
    delete process.env.E2E_DATABASE_URL
  })

  afterEach(() => {
    process.env = savedEnv
  })

  async function datasourceUrl() {
    const { default: config } = await import('@/prisma.config')
    return (config as { datasource?: { url?: string } }).datasource?.url
  }

  it('runs the CLI against the direct host when one is provided', async () => {
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://u:p@direct/db'
    expect(await datasourceUrl()).toBe('postgresql://u:p@direct/db')
  })

  it('falls back to DATABASE_URL when no direct host is set', async () => {
    delete process.env.DATABASE_URL_UNPOOLED
    process.env.DATABASE_URL = 'postgresql://dev:dev@localhost:5432/dev_db'
    // `.env.local` (when present) may override it, so compare post-load.
    expect(await datasourceUrl()).toBe(process.env.DATABASE_URL)
  })

  it('never lets the direct host override an E2E database', async () => {
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://u:p@direct/db'
    process.env.E2E_DATABASE_URL = 'postgresql://e2e:e2e@localhost/e2e'
    expect(await datasourceUrl()).toBe('postgresql://e2e:e2e@localhost/e2e')
  })
})
