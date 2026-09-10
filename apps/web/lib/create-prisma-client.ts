import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma'

/**
 * Prisma 7 requires a driver adapter; the old `datasources: { db: { url } }`
 * constructor option is gone. Use this anywhere a one-off client needs a
 * specific connection string (seed, E2E provisioner, postgres tests).
 */
export function createPrismaClient(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString })
  })
}
