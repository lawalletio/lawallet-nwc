import { vi } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma'

// Deep mock of PrismaClient for unit tests
// Each model gets standard Prisma methods mocked
function createPrismaMock(): PrismaClient {
  const modelMethods = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  }

  return {
    user: { ...modelMethods },
    card: { ...modelMethods },
    cardDesign: { ...modelMethods },
    lightningAddress: { ...modelMethods },
    ntag424: { ...modelMethods },
    settings: { ...modelMethods },
    remoteConnection: { ...modelMethods },
    $transaction: vi.fn((fn) => {
      if (typeof fn === 'function') {
        return fn(prismaMock)
      }
      return Promise.all(fn)
    }),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  } as unknown as PrismaClient
}

export const prismaMock = createPrismaMock()

// Mock the prisma import
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

// Helper to reset all mocks between tests
export function resetPrismaMock() {
  vi.clearAllMocks()
}
