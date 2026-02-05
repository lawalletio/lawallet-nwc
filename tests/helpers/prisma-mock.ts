import { vi } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma'

// Deep mock of PrismaClient for unit tests
// Each model gets its own set of mock methods
function createModelMock() {
  return {
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
}

function createPrismaMock(): PrismaClient {
  return {
    user: createModelMock(),
    card: createModelMock(),
    cardDesign: createModelMock(),
    lightningAddress: createModelMock(),
    ntag424: createModelMock(),
    settings: createModelMock(),
    remoteConnection: createModelMock(),
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
// Uses mockReset() on each model method to clear both calls and implementations,
// then re-applies the $transaction behavior
export function resetPrismaMock() {
  const models = ['user', 'card', 'cardDesign', 'lightningAddress', 'ntag424', 'settings', 'remoteConnection'] as const
  for (const model of models) {
    const m = prismaMock[model] as Record<string, ReturnType<typeof vi.fn>>
    for (const method of Object.values(m)) {
      if (typeof method?.mockReset === 'function') {
        method.mockReset()
      }
    }
  }
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockReset()
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: any) => {
    if (typeof fn === 'function') {
      return fn(prismaMock)
    }
    return Promise.all(fn)
  })
}
