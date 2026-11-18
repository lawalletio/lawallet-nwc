import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma'
import { getConfig } from './config'
import { getEnv } from './config/env'
import { createLogger } from './logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const log = createLogger({ module: 'prisma' })

/**
 * Serverless instances each hold their own pool, so a small `max` keeps a
 * burst of cold starts from exhausting Postgres connections; long-lived
 * servers can afford more. A stuck connect fails fast instead of hanging.
 *
 * Idle connections live 60s: at 10s the 15s balance poll and the listener's
 * 20s tick reconnected almost every time (~22ms `pg.connect`, on 54–85% of
 * LUD-21 verify / zap-settle / LUD-16 requests per Sentry traces). On Vercel
 * `DATABASE_URL` is Neon's `-pooler` host, so a frozen instance pinning ≤3
 * client sockets for a minute costs PgBouncer nothing.
 */
export function poolConfig(env = getEnv(false)) {
  return {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 3 : 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 60_000,
    keepAlive: true
  }
}

function createClient() {
  const env = getEnv(false)
  const adapter = new PrismaPg(poolConfig(env))

  // Queries log at debug (invisible at the default info level); anything
  // slower than SLOW_QUERY_THRESHOLD_MS escalates to warn so slow queries
  // surface in production logs without enabling debug noise. 0 disables.
  // With neither on, Prisma isn't asked to emit query events at all.
  const slowMs = env.SLOW_QUERY_THRESHOLD_MS
  // Optional call: several test suites stub the logger without it.
  const debug = log.isLevelEnabled?.('debug') ?? false
  if (!debug && slowMs <= 0) return new PrismaClient({ adapter })

  const client = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }]
  })

  client.$on('query', event => {
    const slow = slowMs > 0 && event.duration >= slowMs
    if (!slow && !debug) return

    const entry = {
      query: event.query,
      durationMs: event.duration,
      target: event.target
    }
    if (slow) log.warn(entry, 'prisma.slow_query')
    else log.debug(entry, 'prisma.query')
  })

  return client
}

/**
 * Singleton Prisma client. In dev/test we cache it on `globalThis` so Next.js
 * hot reload doesn't open a new connection per module reload; production
 * doesn't re-export so each instance gets its own client.
 */
export const prisma = globalForPrisma.prisma ?? createClient()

const config = getConfig(false) // Use non-strict mode to avoid build-time errors
if (!config.isProduction) globalForPrisma.prisma = prisma
