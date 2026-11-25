import { Relay } from 'nostr-tools/relay'
import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'

/*
 * One relay WebSocket per relay URL for the whole pool, instead of one per
 * NWCClient. @getalby/sdk gives every client its own `ReconnectingPool`, so 94
 * wallets meant 94 sockets (and 94 reconnect loops) from one IP — the shape
 * relay.getalby.com answered with 429 on 2026-11-25.
 *
 * The SDK's `ReconnectingPool` isn't exported, so {@link ClientRelayPool}
 * re-implements the surface `NWCClient` uses (ensureRelay / subscribe /
 * publish / listConnectionStatus / close / destroy) on top of shared sockets.
 * `subscribe` and `publish` mirror the SDK 9 implementation (same backoff,
 * same error shapes) so NWCClient's error mapping is unchanged.
 */

// Mirrors @getalby/sdk 9 ReconnectingPool.
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000
const MAX_KNOWN_IDS = 1000
const PUBLISH_TIMEOUT_MS = 5000
const RELAY_PUBLISH_TIMEOUT_MARGIN_MS = 1000
const CONNECT_TIMEOUT_MS = 3000

export type SubCloser = { close: (reason?: string) => void }

type SubscribeParams = {
  onevent?: (evt: Event) => void
  onconnect?: (url: string) => void
  ondisconnect?: (url: string, reason: string) => void
  abort?: AbortSignal
}

interface SharedSocket {
  url: string
  relay: Relay
  /** Open REQs on this socket (live + reserved by a connecting loop). */
  subs: number
  /** Client pools using the socket; it closes when the last one leaves. */
  users: Set<ClientRelayPool>
}

/** Owns the shared sockets. One per {@link NwcPool}. */
export class SharedRelayHub {
  private readonly sockets = new Map<string, SharedSocket[]>()

  /**
   * @param maxSubsPerSocket REQs per socket before another socket is opened
   *   for the same relay (relay-nwc.rizful.com allows only 100).
   */
  constructor(private readonly maxSubsPerSocket: number) {}

  /**
   * Replaces the client's private `ReconnectingPool` with a shared-socket one.
   * Only a pool of the SDK's shape is replaced, so a future SDK that changes
   * it keeps working (unshared) rather than breaking.
   */
  adopt(client: { pool: unknown }): void {
    const pool = client.pool as Record<string, unknown> | null
    if (
      typeof pool?.ensureRelay !== 'function' ||
      typeof pool.subscribe !== 'function' ||
      typeof pool.publish !== 'function'
    ) {
      return
    }
    client.pool = new ClientRelayPool(this)
  }

  /** Open sockets per relay URL (for tests and /status-style introspection). */
  socketCount(url: string): number {
    return this.sockets.get(normalizeURL(url))?.length ?? 0
  }

  /** @internal Picks (or opens) a socket; `reserveSub` takes a REQ slot. */
  acquire(
    url: string,
    user: ClientRelayPool,
    reserveSub: boolean
  ): SharedSocket {
    let list = this.sockets.get(url)
    if (!list) {
      list = []
      this.sockets.set(url, list)
    }
    let socket = reserveSub
      ? list.find(s => s.subs < this.maxSubsPerSocket)
      : (list.find(s => s.relay.connected) ?? list[0])
    if (!socket) {
      socket = this.open(url)
      list.push(socket)
    }
    socket.users.add(user)
    if (reserveSub) socket.subs++
    return socket
  }

  /** @internal Concurrent callers share one handshake (nostr-tools dedups). */
  async connect(socket: SharedSocket, timeoutMs: number): Promise<Relay> {
    try {
      await socket.relay.connect({ timeout: timeoutMs })
    } catch (err) {
      this.forget(socket)
      throw err
    }
    return socket.relay
  }

  /** @internal */
  releaseSub(socket: SharedSocket): void {
    socket.subs = Math.max(0, socket.subs - 1)
  }

  /** @internal The last user leaving closes the socket. */
  leave(socket: SharedSocket, user: ClientRelayPool): void {
    socket.users.delete(user)
    if (socket.users.size > 0) return
    this.forget(socket)
    try {
      socket.relay.close()
    } catch {
      // best-effort
    }
  }

  private open(url: string): SharedSocket {
    // Reconnects are owned by the subscription loops (as in the SDK); a
    // nostr-tools auto-reconnect would re-fire REQs without telling them.
    const relay = new Relay(url, { enablePing: false, enableReconnect: false })
    relay.publishTimeout = PUBLISH_TIMEOUT_MS + RELAY_PUBLISH_TIMEOUT_MARGIN_MS
    const socket: SharedSocket = { url, relay, subs: 0, users: new Set() }
    // A dead socket is never reused: the next acquire dials a fresh one, and
    // its subscriptions' onclose sends every loop there.
    relay.onclose = () => this.forget(socket)
    return socket
  }

  private forget(socket: SharedSocket): void {
    const list = this.sockets.get(socket.url)
    if (!list) return
    const i = list.indexOf(socket)
    if (i >= 0) list.splice(i, 1)
    if (list.length === 0) this.sockets.delete(socket.url)
  }
}

/**
 * Drop-in for the SDK's per-client `ReconnectingPool`. `close()` only ends
 * the subscriptions THIS client opened and leaves the shared sockets — one
 * wallet's teardown never touches another wallet's socket.
 */
export class ClientRelayPool {
  readonly publishTimeout = PUBLISH_TIMEOUT_MS
  enablePing: boolean | undefined = false
  maxWaitForConnection = CONNECT_TIMEOUT_MS
  private _closed = false
  private readonly used = new Set<SharedSocket>()
  private readonly subs = new Set<SubCloser>()
  /** Socket each relay URL last resolved to — the connection status source. */
  private readonly current = new Map<string, Relay>()

  constructor(private readonly hub: SharedRelayHub) {}

  get closed(): boolean {
    return this._closed
  }

  async ensureRelay(
    url: string,
    params?: { connectionTimeout?: number; abort?: AbortSignal }
  ): Promise<Relay> {
    if (this._closed) throw new Error('pool is closed')
    url = normalizeURL(url)
    const socket = this.use(url, false)
    const relay = await this.hub.connect(
      socket,
      params?.connectionTimeout ?? this.maxWaitForConnection
    )
    if (this._closed) throw new Error('pool is closed')
    this.current.set(url, relay)
    return relay
  }

  subscribe(
    relays: string[],
    filter: Filter,
    params: SubscribeParams
  ): SubCloser {
    const urls = [...new Set(relays.map(normalizeURL))]
    let closed = false
    const activeSubs = new Map<string, SubCloser>()
    const pendingWaits = new Set<() => void>()
    const knownIds = new Set<string>()
    const alreadyHaveEvent = (id: string) => {
      if (knownIds.has(id)) return true
      knownIds.add(id)
      if (knownIds.size > MAX_KNOWN_IDS) {
        const oldest = knownIds.values().next().value
        if (oldest !== undefined) knownIds.delete(oldest)
      }
      return false
    }
    const stopped = () => closed || this._closed

    const waitForReconnect = (attempt: number): Promise<void> => {
      if (stopped()) return Promise.resolve()
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** attempt,
        MAX_RECONNECT_DELAY_MS
      )
      return new Promise<void>(resolve => {
        const cancel = () => {
          clearTimeout(timer)
          pendingWaits.delete(cancel)
          resolve()
        }
        const timer = setTimeout(cancel, delay)
        pendingWaits.add(cancel)
      })
    }

    const runRelay = async (url: string) => {
      let attempt = 0
      while (!stopped()) {
        const socket = this.use(url, true)
        let relay: Relay
        try {
          relay = await this.hub.connect(socket, this.maxWaitForConnection)
        } catch (err) {
          this.hub.releaseSub(socket)
          if (stopped()) return
          const reason = (err as { message?: string })?.message || String(err)
          params.ondisconnect?.(url, reason)
          await waitForReconnect(attempt++)
          continue
        }
        if (stopped()) {
          this.hub.releaseSub(socket)
          return
        }
        this.current.set(url, relay)
        params.onconnect?.(url)
        attempt = 0

        const closeReason = await new Promise<string>(resolve => {
          try {
            const inner = relay.subscribe([filter], {
              eoseTimeout: 1, // 1ms (0 would mean nostr-tools' 4400ms default)
              onevent: params.onevent,
              onclose: resolve,
              abort: params.abort,
              alreadyHaveEvent
            })
            activeSubs.set(url, inner)
          } catch (err) {
            resolve(String(err))
          }
        })
        activeSubs.delete(url)
        this.hub.releaseSub(socket)
        if (stopped()) return
        params.ondisconnect?.(url, closeReason)
        await waitForReconnect(attempt++)
      }
    }

    for (const url of urls) void runRelay(url)

    const closer: SubCloser = {
      close: (reason?: string) => {
        if (closed) return
        closed = true
        this.subs.delete(closer)
        for (const cancel of [...pendingWaits]) cancel()
        pendingWaits.clear()
        for (const sub of activeSubs.values()) sub.close(reason)
        activeSubs.clear()
      }
    }
    this.subs.add(closer)
    return closer
  }

  publish(
    relays: string[],
    event: Event,
    params?: { abort?: AbortSignal }
  ): Promise<string>[] {
    return relays.map(normalizeURL).map(async (url, i, arr) => {
      if (arr.indexOf(url) !== i) {
        return Promise.reject('duplicate url')
      }
      let relay: Relay
      try {
        relay = await this.ensureRelay(url, {
          connectionTimeout: this.maxWaitForConnection,
          abort: params?.abort
        })
      } catch (err) {
        // NWCClient reads this prefix as a connection failure (Promise.any).
        throw new Error('connection failure: ' + String(err))
      }
      return relay.publish(event)
    })
  }

  listConnectionStatus(): Map<string, boolean> {
    const map = new Map<string, boolean>()
    for (const [url, relay] of this.current) map.set(url, relay.connected)
    return map
  }

  /** Ends this client's subscriptions and leaves its sockets; never closes a shared one in use. */
  close(_relays?: string[]): void {
    if (this._closed) return
    this._closed = true
    for (const sub of [...this.subs]) sub.close('client closed')
    this.subs.clear()
    for (const socket of this.used) this.hub.leave(socket, this)
    this.used.clear()
    this.current.clear()
  }

  destroy(): void {
    this.close()
  }

  private use(url: string, reserveSub: boolean): SharedSocket {
    const socket = this.hub.acquire(url, this, reserveSub)
    this.used.add(socket)
    return socket
  }
}

/** @getalby/sdk 9's relay URL normalization, so keys match what it would produce. */
export function normalizeURL(url: string): string {
  if (url.indexOf('://') === -1) url = 'wss://' + url
  const p = new URL(url)
  if (p.protocol === 'http:') p.protocol = 'ws:'
  else if (p.protocol === 'https:') p.protocol = 'wss:'
  p.pathname = p.pathname.replace(/\/+/g, '/')
  if (p.pathname.endsWith('/')) p.pathname = p.pathname.slice(0, -1)
  if (
    (p.port === '80' && p.protocol === 'ws:') ||
    (p.port === '443' && p.protocol === 'wss:')
  ) {
    p.port = ''
  }
  p.searchParams.sort()
  p.hash = ''
  return p.toString()
}
