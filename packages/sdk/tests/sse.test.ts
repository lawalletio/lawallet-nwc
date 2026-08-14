import { verifyEvent, type NostrEvent } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LaWalletClient, generateSigner } from '../src'
import type { EventSourceLike } from '../src'
import { ENDPOINT } from './helpers'

type Listener = (event: { data?: string }) => void

class StubEventSource implements EventSourceLike {
  static instances: StubEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    StubEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data })
    }
  }
}

function tokenEvent(source: StubEventSource): NostrEvent {
  const token = new URL(source.url).searchParams.get('token')!
  return JSON.parse(atob(token))
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('events.subscribe', () => {
  beforeEach(() => {
    StubEventSource.instances = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects with a freshly signed NIP-98 query token and delivers events', async () => {
    const { signer, pubkey } = generateSigner()
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      signer,
      EventSourceImpl: StubEventSource
    })

    const received: Array<[string, Record<string, unknown>]> = []
    const unsubscribe = client.events.subscribe((type, data) =>
      received.push([type, data])
    )
    await flush()

    expect(StubEventSource.instances).toHaveLength(1)
    const source = StubEventSource.instances[0]
    expect(source.url.startsWith(`${ENDPOINT}/api/events?token=`)).toBe(true)

    // The query token is a bare base64 kind-27235 event signed by the user,
    // committing to the events URL without any query string.
    const event = tokenEvent(source)
    expect(event.kind).toBe(27235)
    expect(event.pubkey).toBe(pubkey)
    expect(verifyEvent(event)).toBe(true)
    expect(event.tags).toContainEqual(['u', `${ENDPOINT}/api/events`])

    source.emit(
      'addresses:updated',
      JSON.stringify({ type: 'addresses:updated', timestamp: 1 })
    )
    expect(received).toEqual([
      ['addresses:updated', { type: 'addresses:updated', timestamp: 1 }]
    ])

    unsubscribe()
    expect(source.closed).toBe(true)
  })

  it('re-signs a fresh token on reconnect', async () => {
    vi.useFakeTimers()
    const { signer } = generateSigner()
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      signer,
      EventSourceImpl: StubEventSource
    })

    const unsubscribe = client.events.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(StubEventSource.instances).toHaveLength(1)

    StubEventSource.instances[0].emit('error')
    await vi.advanceTimersByTimeAsync(1000)

    expect(StubEventSource.instances).toHaveLength(2)
    expect(StubEventSource.instances[0].closed).toBe(true)
    const first = tokenEvent(StubEventSource.instances[0])
    const second = tokenEvent(StubEventSource.instances[1])
    expect(verifyEvent(second)).toBe(true)
    expect(second.sig).not.toBe(first.sig)

    unsubscribe()
  })

  it('stops reconnecting after unsubscribe', async () => {
    vi.useFakeTimers()
    const { signer } = generateSigner()
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      signer,
      EventSourceImpl: StubEventSource
    })

    const unsubscribe = client.events.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    StubEventSource.instances[0].emit('error')
    unsubscribe()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(StubEventSource.instances).toHaveLength(1)
  })
})
