import { describe, expect, it, vi } from 'vitest'

/**
 * Prisma 7 dropped `datasources.url` on the client constructor. This helper
 * is the only place that wires a one-off client to `@prisma/adapter-pg`.
 * Postgres e2e files call it but skip without a live DB, so coverage has
 * to come from a unit test that never opens a socket.
 *
 * Vitest 5 requires a real constructor (`new PrismaClient(...)`); a plain
 * `vi.fn().mockImplementation(...)` is not constructable.
 */
const { adapterOpts, clientOpts } = vi.hoisted(() => ({
  adapterOpts: [] as Array<{ connectionString: string }>,
  clientOpts: [] as Array<{ adapter: { connectionString: string } }>
}))

vi.mock('@prisma/adapter-pg', () => {
  class FakePrismaPg {
    connectionString: string
    constructor(opts: { connectionString: string }) {
      adapterOpts.push(opts)
      this.connectionString = opts.connectionString
    }
  }
  return { PrismaPg: FakePrismaPg }
})

vi.mock('@/lib/generated/prisma', () => {
  class FakePrismaClient {
    adapter: { connectionString: string }
    constructor(opts: { adapter: { connectionString: string } }) {
      clientOpts.push(opts)
      this.adapter = opts.adapter
    }
  }
  return { PrismaClient: FakePrismaClient }
})

import { createPrismaClient } from '@/lib/create-prisma-client'
import { PrismaClient } from '@/lib/generated/prisma'

describe('createPrismaClient', () => {
  it('constructs a Prisma 7 client with a PrismaPg adapter for the given URL', () => {
    const connectionString = 'postgresql://ci:ci@localhost:5432/ci'
    const client = createPrismaClient(connectionString)

    expect(client).toBeInstanceOf(PrismaClient)
    expect(adapterOpts).toEqual([{ connectionString }])
    expect(clientOpts).toHaveLength(1)
    expect(clientOpts[0].adapter.connectionString).toBe(connectionString)
  })
})
