import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Covers the pool sizing and the query-log gating in `lib/prisma.ts` without
 * opening a socket: the adapter and client are fakes that record their
 * options, and every test re-imports the module against a fresh env.
 */
const h = vi.hoisted(() => ({
  adapterOpts: [] as Record<string, unknown>[],
  clientOpts: [] as Record<string, unknown>[],
  onQuery: [] as Array<(e: unknown) => void>,
  log: {
    isLevelEnabled: vi.fn(() => false),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(opts: Record<string, unknown>) {
      h.adapterOpts.push(opts)
    }
  }
}))

vi.mock('@/lib/generated/prisma', () => ({
  PrismaClient: class {
    constructor(opts: Record<string, unknown>) {
      h.clientOpts.push(opts)
    }
    $on(_: string, fn: (e: unknown) => void) {
      h.onQuery.push(fn)
    }
  }
}))

vi.mock('@/lib/logger', () => ({ createLogger: () => h.log }))

const saved = { ...process.env }

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  delete (globalThis as { prisma?: unknown }).prisma
  process.env = { ...saved, DATABASE_URL: 'postgresql://x@h/db', ...env }
  for (const [k, v] of Object.entries(env))
    if (v === undefined) delete process.env[k]
  return import('@/lib/prisma')
}

beforeEach(() => {
  h.adapterOpts.length = 0
  h.clientOpts.length = 0
  h.onQuery.length = 0
  h.log.isLevelEnabled.mockReturnValue(false)
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = saved
  delete (globalThis as { prisma?: unknown }).prisma
})

describe('lib/prisma pool', () => {
  it('uses a small pool on Vercel', async () => {
    await load({ VERCEL: '1', DATABASE_POOL_MAX: undefined })
    expect(h.adapterOpts[0]).toEqual({
      connectionString: 'postgresql://x@h/db',
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000
    })
  })

  it('uses a larger pool on long-lived servers', async () => {
    await load({ VERCEL: undefined, DATABASE_POOL_MAX: undefined })
    expect(h.adapterOpts[0].max).toBe(10)
  })

  it('honours DATABASE_POOL_MAX', async () => {
    await load({ VERCEL: '1', DATABASE_POOL_MAX: '7' })
    expect(h.adapterOpts[0].max).toBe(7)
  })
})

describe('lib/prisma query logging', () => {
  it('skips query events entirely when debug is off and slow logging is disabled', async () => {
    await load({ SLOW_QUERY_THRESHOLD_MS: '0' })
    expect(h.clientOpts[0].log).toBeUndefined()
    expect(h.onQuery).toHaveLength(0)
  })

  it('only logs slow queries at info level', async () => {
    await load({ SLOW_QUERY_THRESHOLD_MS: '100' })
    const [listener] = h.onQuery
    listener({ query: 'SELECT 1', duration: 5, target: 'q' })
    expect(h.log.warn).not.toHaveBeenCalled()
    expect(h.log.debug).not.toHaveBeenCalled()

    listener({ query: 'SELECT 2', duration: 150, target: 'q' })
    expect(h.log.warn).toHaveBeenCalledWith(
      { query: 'SELECT 2', durationMs: 150, target: 'q' },
      'prisma.slow_query'
    )
  })

  it('logs every query at debug level', async () => {
    h.log.isLevelEnabled.mockReturnValue(true)
    await load({ SLOW_QUERY_THRESHOLD_MS: '0' })
    h.onQuery[0]({ query: 'SELECT 1', duration: 5, target: 'q' })
    expect(h.log.debug).toHaveBeenCalledWith(
      { query: 'SELECT 1', durationMs: 5, target: 'q' },
      'prisma.query'
    )
  })
})
