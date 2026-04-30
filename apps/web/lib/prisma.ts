import { PrismaClient } from './generated/prisma'
import { getConfig } from './config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Singleton Prisma client. In dev/test we cache it on `globalThis` so Next.js
 * hot reload doesn't open a new connection per module reload; production
 * doesn't re-export so each instance gets its own client.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query']
  })

const config = getConfig(false) // Use non-strict mode to avoid build-time errors
if (!config.isProduction) globalForPrisma.prisma = prisma
