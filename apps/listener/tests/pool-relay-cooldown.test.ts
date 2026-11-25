import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesiredWallet } from '../src/db'

const control = vi.hoisted(() => ({
  /** Hosts whose handshake fails the way the SDK reports a 429. */
  throttled: new Set<string>(),
  /** Hosts whose already-open sockets read as connected. */
  down: new Set<string>(),
  /** Every handshake attempt, by host. */
  dials: [] as string[],
  getInfoCalls: 0,
  getInfoError: null as Error | null,
  closed: 0
}))

vi.mock('@getalby/sdk', () => {
  class Nip47Error extends Error {
    code: string
    constructor(message: string, code = 'ERR') {
      super(message)
      this.code = code
    }
  }
  class Nip47WalletError extends Nip47Error {}
  class Nip47TimeoutError extends Nip47Error {}
  class Nip47NetworkError extends Nip47Error {}

  class NWCClient {
    relayUrls: string[]
    host: string
    ready = false
    pool = {
      listConnectionStatus: () =>
        new Map([[this.relayUrls[0] + '/', this.connected]])
    }
    constructor(options: { nostrWalletConnectUrl: string }) {
      const relay = new URL(options.nostrWalletConnectUrl).searchParams.get(
        'relay'
      )!
      this.relayUrls = [relay]
      this.host = new URL(relay).host
    }
    get connected() {
      return this.ready && !control.down.has(this.host)
    }
    async subscribeNotifications() {
      control.dials.push(this.host)
      if (control.throttled.has(this.host)) {
        throw new Nip47NetworkError(
          `Failed to connect to ${this.relayUrls[0]}`,
          'OTHER'
        )
      }
      this.ready = true
      return () => {}
    }
    async getInfo() {
      control.getInfoCalls++
      if (control.getInfoError) throw control.getInfoError
      return { methods: ['pay_invoice'] }
    }
    async payInvoice() {
      return { preimage: 'p' }
    }
    close() {
      control.closed++
      this.ready = false
    }
  }

  return {
    NWCClient,
    Nip47Error,
    Nip47WalletError,
    Nip47TimeoutError,
    Nip47NetworkError
  }
})

import {
  NwcPool,
  NwcPoolError,
  isRelayThrottleError,
  relayHosts
} from '../src/nwc/pool'

const log = pino({ level: 'silent' })

const walletOn = (id: string, host: string): DesiredWallet => ({
  id,
  name: id,
  userId: 'user',
  connectionString: `nostr+walletconnect://pk-${id}?relay=wss://${host}&secret=s-${id}`
})

const ALBY = 'relay.alby.test'
const OTHER = 'relay.other.test'

function makePool(
  extra: Partial<ConstructorParameters<typeof NwcPool>[0]> = {}
) {
  return new NwcPool({
    log,
    onNotification: vi.fn(),
    relayCooldownBaseMs: 5000,
    relayCooldownMaxMs: 300000,
    ...extra
  })
}

const dialsTo = (host: string) => control.dials.filter(h => h === host).length

describe('relay helpers', () => {
  it('reads relay hosts from the connection string', () => {
    expect(
      relayHosts(
        'nostr+walletconnect://pk?relay=wss%3A%2F%2FRelay.Getalby.com%2Fv1&relay=wss://relay2.getalby.com&secret=s'
      )
    ).toEqual(['relay.getalby.com', 'relay2.getalby.com'])
    expect(relayHosts('not a url')).toEqual([])
  })

  it('classifies handshake refusals as throttling, wallet errors as not', () => {
    for (const msg of [
      'Failed to connect to wss://relay.getalby.com/v1',
      'failed to publish: wss://x: connection failure: Error: 429',
      'rate-limited: slow down',
      'Unexpected server response: 429'
    ]) {
      expect(isRelayThrottleError(new Error(msg))).toBe(true)
    }
    for (const msg of [
      'reply timeout: event abc',
      'no info event (kind 13194) returned from relay',
      'INSUFFICIENT_BALANCE'
    ]) {
      expect(isRelayThrottleError(new Error(msg))).toBe(false)
    }
  })
})

describe('NwcPool — per-relay-host cooldown', () => {
  beforeEach(() => {
    control.throttled.clear()
    control.down.clear()
    control.dials = []
    control.getInfoCalls = 0
    control.getInfoError = null
    control.closed = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses every wallet on a throttled host behind one shared backoff', async () => {
    control.throttled.add(ALBY)
    const wallets = Array.from({ length: 20 }, (_, i) =>
      walletOn(`w${i}`, ALBY)
    )
    const pool = makePool()
    await pool.reconcile(wallets)
    await vi.advanceTimersByTimeAsync(0)
    const firstWave = dialsTo(ALBY)
    expect(firstWave).toBeGreaterThan(0)
    expect(pool.isRelayCoolingDown('w0')).toBe(true)

    // Per-wallet backoff alone would be ~20 wallets × 6 retries in a minute.
    // Shared: one probe per expiry (5s, then 10s, then 20s → ~3 in 60s).
    await vi.advanceTimersByTimeAsync(60000)
    const probes = dialsTo(ALBY) - firstWave
    expect(probes).toBeGreaterThanOrEqual(2)
    expect(probes).toBeLessThanOrEqual(4)
    await pool.closeAll()
  })

  it('clears on the first successful probe and lets the rest reconnect', async () => {
    control.throttled.add(ALBY)
    const wallets = Array.from({ length: 5 }, (_, i) => walletOn(`w${i}`, ALBY))
    const pool = makePool()
    await pool.reconcile(wallets)
    await vi.advanceTimersByTimeAsync(0)
    expect(pool.readinessSummary().ready).toBe(0)

    control.throttled.delete(ALBY)
    await vi.advanceTimersByTimeAsync(30000)
    expect(pool.isRelayCoolingDown('w0')).toBe(false)
    expect(pool.readinessSummary()).toMatchObject({ total: 5, ready: 5 })
    await pool.closeAll()
  })

  it('fails requests for a cooling host fast without touching the SDK, other hosts unaffected', async () => {
    const pool = makePool()
    const albyReady = walletOn('alby-ready', ALBY)
    const other = walletOn('other', OTHER)
    await pool.reconcile([albyReady, other])
    await vi.advanceTimersByTimeAsync(0)
    expect(pool.isReady('alby-ready')).toBe(true)

    // A new wallet on the same host gets 429'd → the host cools down.
    control.throttled.add(ALBY)
    await pool.reconcileOne('alby-new', walletOn('alby-new', ALBY))
    await vi.advanceTimersByTimeAsync(0)
    expect(pool.isRelayCoolingDown('alby-ready')).toBe(true)

    const before = control.getInfoCalls
    const request = pool.request(
      albyReady.connectionString,
      'get_info',
      {},
      1000
    )
    await expect(request).rejects.toBeInstanceOf(NwcPoolError)
    await expect(request).rejects.toMatchObject({ code: 'relay_error' })
    expect(control.getInfoCalls).toBe(before)

    // Payments must read as "never dispatched" so web may fall back.
    await expect(
      pool.payInvoiceByWalletId('alby-ready', 'lnbc1')
    ).rejects.toMatchObject({ code: 'wallet_not_connected' })

    // The cooldown is per host.
    await expect(
      pool.request(other.connectionString, 'get_info', {}, 1000)
    ).resolves.toMatchObject({ methods: ['pay_invoice'] })
    // Dead-wallet probes skip the cooling host too.
    expect(pool.deadCandidates(0).map(c => c.wallet.id)).toEqual(['other'])
    await pool.closeAll()
  })

  it('a request that fails to reach the relay opens the cooldown', async () => {
    const pool = makePool()
    const w = walletOn('w', ALBY)
    await pool.reconcile([w])
    await vi.advanceTimersByTimeAsync(0)

    control.getInfoError = new Error('Failed to connect to wss://' + ALBY)
    await expect(
      pool.request(w.connectionString, 'get_info', {}, 1000)
    ).rejects.toMatchObject({ code: 'relay_error' })
    expect(pool.isRelayCoolingDown('w')).toBe(true)
    await pool.closeAll()
  })

  it('drops disconnected clients on a cooling host so the SDK stops redialing', async () => {
    const pool = makePool()
    await pool.reconcile([walletOn('a', ALBY), walletOn('b', ALBY)])
    await vi.advanceTimersByTimeAsync(0)
    expect(pool.readinessSummary().ready).toBe(2)

    // Relay drops every socket and 429s the redials.
    control.down.add(ALBY)
    control.throttled.add(ALBY)
    await pool.reconcileOne('c', walletOn('c', ALBY))
    await vi.advanceTimersByTimeAsync(0)
    expect(control.closed).toBeGreaterThanOrEqual(2)
    expect(
      pool
        .snapshot()
        .filter(c => c.walletId !== 'c')
        .map(c => c.lastError)
    ).toEqual(['relay host cooling down', 'relay host cooling down'])

    // Relay recovers → the pool, not the SDK, brings them back.
    control.down.delete(ALBY)
    control.throttled.delete(ALBY)
    await vi.advanceTimersByTimeAsync(30000)
    expect(pool.readinessSummary().ready).toBe(3)
    await pool.closeAll()
  })

  it('staggers connect starts', async () => {
    const pool = makePool({ connectStaggerMs: 1000 })
    await pool.reconcile([
      walletOn('a', ALBY),
      walletOn('b', OTHER),
      walletOn('c', ALBY)
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(control.dials).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(control.dials).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(control.dials).toHaveLength(3)
    await pool.closeAll()
  })
})
