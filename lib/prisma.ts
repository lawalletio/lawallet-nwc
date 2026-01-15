import { PrismaClient } from './generated/prisma'
import { getConfig } from './config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query']
  })

const config = getConfig(false) // Use non-strict mode to avoid build-time errors
if (!config.isProduction) globalForPrisma.prisma = prisma
