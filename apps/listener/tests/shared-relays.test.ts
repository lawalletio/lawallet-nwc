import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSub = { close: (reason?: string) => void }

const net = vi.hoisted(() => ({
  relays: [] as Array<{
    url: string
    connected: boolean
    connects: number
    closedByUs: boolean
    subs: Set<FakeSub>
    drop: () => void
  }>,
  failConnect: false
}))

vi.mock('nostr-tools/relay', () => {
  class Relay {
    url: string
    connected = false
    connects = 0
    closedByUs = false
    publishTimeout = 0
    onclose: (() => void) | null = null
    subs = new Set<FakeSub>()
    constructor(url: string) {
      this.url = url
      net.relays.push(this)
    }
    async connect() {
      this.connects++
      if (net.failConnect) {
        this.onclose?.()
        throw 'connection failed'
      }
      this.connected = true
    }
    subscribe(_filters: unknown, params: { onclose?: (r: string) => void }) {
      let closed = false
      const sub: FakeSub = {
        close: (reason = 'closed by caller') => {
          if (closed) return
          closed = true
          this.subs.delete(sub)
          params.onclose?.(reason)
        }
      }
      this.subs.add(sub)
      return sub
    }
    async publish() {
      return 'ok'
    }
    private hardClose(reason: string) {
      this.connected = false
      for (const sub of [...this.subs]) sub.close(reason)
      this.onclose?.()
    }
    close() {
      this.closedByUs = true
      this.hardClose('relay connection closed by us')
    }
    /** The relay (not us) drops the socket. */
    drop() {
      this.hardClose('relay connection closed')
    }
  }
  return { Relay }
})

vi.mock('@getalby/sdk', () => {
  class Nip47Error extends Error {}
  class Nip47WalletError extends Nip47Error {}
  class Nip47TimeoutError extends Nip47Error {}
  // Talks to whatever `pool` it holds, like the real SDK: a handshake check,
  // then a long-lived notification subscription.
  class NWCClient {
    relayUrls: string[]
    pool: {
      ensureRelay: (url: string) => Promise<unknown>
      subscribe: (...args: unknown[]) => { close: () => void }
      publish: () => unknown
      listConnectionStatus: () => Map<string, boolean>
      close: (relays: string[]) => void
    } = {
      ensureRelay: async () => {
        throw new Error('unshared SDK pool used')
      },
      subscribe: () => ({ close() {} }),
      publish: () => [],
      listConnectionStatus: () => new Map(),
      close: () => {}
    }
    constructor(options: { nostrWalletConnectUrl: string }) {
      this.relayUrls = [
        new URL(options.nostrWalletConnectUrl).searchParams.get('relay')!
      ]
    }
    get connected() {
      return [...this.pool.listConnectionStatus().values()].includes(true)
    }
    async subscribeNotifications() {
      await this.pool.ensureRelay(this.relayUrls[0])
      const sub = this.pool.subscribe(this.relayUrls, {}, {})
      return () => sub.close()
    }
    async getInfo() {
      return { methods: [] }
    }
    close() {
      return this.pool.close(this.relayUrls)
    }
  }
  return { NWCClient, Nip47Error, Nip47WalletError, Nip47TimeoutError }
})

import { ClientRelayPool, SharedRelayHub } from '../src/nwc/shared-relays'
import { NwcPool } from '../src/nwc/pool'

const URL_A = 'wss://relay.alby.test/v1'
const filter = { kinds: [23196] }
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('SharedRelayHub / ClientRelayPool', () => {
  beforeEach(() => {
    net.relays = []
    net.failConnect = false
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('two clients on one relay share a single socket', async () => {
    const hub = new SharedRelayHub(100)
    const a = new ClientRelayPool(hub)
    const b = new ClientRelayPool(hub)
    a.subscribe([URL_A], filter, {})
    b.subscribe([URL_A], filter, {})
    await a.ensureRelay(URL_A)
    await flush()

    expect(net.relays).toHaveLength(1)
    expect(net.relays[0].subs.size).toBe(2)
    expect([...a.listConnectionStatus().values()]).toEqual([true])
    expect([...b.listConnectionStatus().values()]).toEqual([true])
  })

  it("tearing one client down leaves the other's subscription and socket up; the last one closes it", async () => {
    const hub = new SharedRelayHub(100)
    const a = new ClientRelayPool(hub)
    const b = new ClientRelayPool(hub)
    a.subscribe([URL_A], filter, {})
    b.subscribe([URL_A], filter, {})
    await flush()
    const [socket] = net.relays

    a.close([URL_A])
    await flush()
    expect(socket.closedByUs).toBe(false)
    expect(socket.connected).toBe(true)
    expect(socket.subs.size).toBe(1)
    expect([...b.listConnectionStatus().values()]).toEqual([true])
    await expect(a.ensureRelay(URL_A)).rejects.toThrow('pool is closed')

    b.destroy()
    await flush()
    expect(socket.closedByUs).toBe(true)
    expect(hub.socketCount(URL_A)).toBe(0)
  })

  it('spills past the per-socket subscription cap into another socket', async () => {
    const hub = new SharedRelayHub(2)
    for (let i = 0; i < 3; i++) {
      new ClientRelayPool(hub).subscribe([URL_A], filter, {})
    }
    await flush()
    expect(net.relays.map(r => r.subs.size)).toEqual([2, 1])
    expect(hub.socketCount(URL_A)).toBe(2)
  })

  it('a dropped socket is redialed ONCE for every subscriber on it', async () => {
    const hub = new SharedRelayHub(100)
    const onconnect = vi.fn()
    for (let i = 0; i < 5; i++) {
      new ClientRelayPool(hub).subscribe([URL_A], filter, { onconnect })
    }
    await flush()
    expect(net.relays).toHaveLength(1)

    net.relays[0].drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(net.relays).toHaveLength(2)
    expect(net.relays[1].connects).toBe(5) // nostr-tools dedups concurrent connects
    expect(net.relays[1].subs.size).toBe(5)
    expect(onconnect).toHaveBeenCalledTimes(10)
  })

  it('reports a failed handshake the way NWCClient expects', async () => {
    net.failConnect = true
    const pool = new ClientRelayPool(new SharedRelayHub(100))
    const [publish] = pool.publish([URL_A], {} as never)
    await expect(publish).rejects.toThrow(/^connection failure: /)
    await expect(pool.ensureRelay(URL_A)).rejects.toBe('connection failed')
  })

  it('only adopts SDK-shaped pools', () => {
    const hub = new SharedRelayHub(100)
    const sdkShaped = {
      pool: { ensureRelay() {}, subscribe() {}, publish() {} } as unknown
    }
    hub.adopt(sdkShaped)
    expect(sdkShaped.pool).toBeInstanceOf(ClientRelayPool)
    const other = { pool: { listConnectionStatus() {} } as unknown }
    hub.adopt(other)
    expect(other.pool).not.toBeInstanceOf(ClientRelayPool)
  })
})

describe('NwcPool shares relay sockets across wallets', () => {
  beforeEach(() => {
    net.relays = []
    net.failConnect = false
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const walletOn = (id: string) => ({
    id,
    name: id,
    userId: 'u',
    connectionString: `nostr+walletconnect://pk-${id}?relay=${encodeURIComponent(URL_A)}&secret=s`
  })

  it('opens one socket for many wallets and keeps it when one wallet leaves', async () => {
    const pool = new NwcPool({
      log: pino({ level: 'silent' }),
      onNotification: vi.fn()
    })
    await pool.reconcile([walletOn('a'), walletOn('b'), walletOn('c')])
    await flush()
    expect(pool.readinessSummary()).toMatchObject({ total: 3, ready: 3 })
    expect(net.relays).toHaveLength(1)
    expect(net.relays[0].subs.size).toBe(3)

    await pool.reconcile([walletOn('b'), walletOn('c')])
    await flush()
    expect(net.relays[0].closedByUs).toBe(false)
    expect(net.relays[0].subs.size).toBe(2)
    expect(pool.readinessSummary()).toMatchObject({ total: 2, ready: 2 })

    await pool.closeAll()
    await flush()
    expect(net.relays[0].closedByUs).toBe(true)
  })
})
