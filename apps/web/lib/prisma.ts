import { PrismaClient } from './generated/prisma'
import { getConfig } from './config'
import { getEnv } from './config/env'
import { createLogger } from './logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const log = createLogger({ module: 'prisma' })

function createClient() {
  const client = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }]
  })

  // Queries log at debug (invisible at the default info level); anything
  // slower than SLOW_QUERY_THRESHOLD_MS escalates to warn so slow queries
  // surface in production logs without enabling debug noise. 0 disables.
  const slowMs = getEnv(false).SLOW_QUERY_THRESHOLD_MS

  client.$on('query', event => {
    const entry = {
      query: event.query,
      durationMs: event.duration,
      target: event.target
    }

    if (slowMs > 0 && event.duration >= slowMs) {
      log.warn(entry, 'prisma.slow_query')
    } else {
      log.debug(entry, 'prisma.query')
    }
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
