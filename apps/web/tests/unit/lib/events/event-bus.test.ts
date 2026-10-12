import { describe, expect, it, vi } from 'vitest'
import { Permission } from '@/lib/auth/permissions'
import { eventBus, trySend, type SSEClient } from '@/lib/events/event-bus'

function makeClient(
  id: string,
  opts: { permissions?: Permission[]; userId?: string } = {}
) {
  const chunks: string[] = []
  let controller!: ReadableStreamDefaultController
  // Never read: chunks pile up in the queue like a stalled client.
  new ReadableStream({
    start(c) {
      controller = c
    }
  })
  const wrapped = {
    get desiredSize() {
      return controller.desiredSize
    },
    enqueue(chunk: Uint8Array) {
      chunks.push(new TextDecoder().decode(chunk))
      controller.enqueue(chunk)
    },
    close: () => controller.close(),
    error: (e: unknown) => controller.error(e)
  } as ReadableStreamDefaultController
  const client: SSEClient = {
    id,
    controller: wrapped,
    permissions: opts.permissions ?? [],
    userId: opts.userId,
    connectedAt: Date.now()
  }
  return { client, chunks }
}

describe('trySend', () => {
  it('drops a client whose unread queue exceeds the limit', () => {
    const { client } = makeClient('slow')
    let sent = 0
    while (trySend(client.controller, new Uint8Array([1]))) sent++
    expect(sent).toBeGreaterThan(0)
    expect(sent).toBeLessThan(64)
    // Closed: further sends keep failing.
    expect(trySend(client.controller, new Uint8Array([1]))).toBe(false)
  })

  it('still sends when the stream reports no desiredSize', () => {
    const enqueue = vi.fn()
    const controller = {
      desiredSize: null,
      enqueue
    } as unknown as ReadableStreamDefaultController

    expect(trySend(controller, new Uint8Array([1]))).toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})

describe('eventBus broadcast', () => {
  it('drops a client the send fails for', () => {
    const before = eventBus.getClientCount()
    const enqueue = vi.fn(() => {
      throw new Error('closed')
    })
    eventBus.addClient({
      id: 'gone',
      controller: {
        desiredSize: 1,
        enqueue
      } as unknown as ReadableStreamDefaultController,
      permissions: [],
      connectedAt: Date.now()
    })

    eventBus.emit({ type: 'invoices:updated', timestamp: 1 })

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(eventBus.getClientCount()).toBe(before)
  })
})

describe('eventBus user scoping', () => {
  it('delivers a userId-scoped event only to that user and admins', () => {
    const owner = makeClient('owner', { userId: 'u1' })
    const other = makeClient('other', { userId: 'u2' })
    const admin = makeClient('admin', {
      userId: 'u3',
      permissions: [Permission.REMOTE_WALLETS_READ]
    })
    for (const c of [owner, other, admin]) eventBus.addClient(c.client)

    eventBus.emit({ type: 'invoices:updated', timestamp: 1, userId: 'u1' })

    expect(owner.chunks).toHaveLength(1)
    expect(admin.chunks).toHaveLength(1)
    expect(other.chunks).toHaveLength(0)
    // The scope is routing metadata, not payload.
    expect(owner.chunks[0]).not.toContain('u1')

    eventBus.emit({ type: 'invoices:updated', timestamp: 2 })
    expect(other.chunks).toHaveLength(1)

    for (const c of [owner, other, admin]) eventBus.removeClient(c.client.id)
  })
})
