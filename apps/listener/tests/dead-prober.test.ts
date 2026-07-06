import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesiredWallet } from '../src/db'

const control = vi.hoisted(() => ({
  connected: true,
  getInfo: vi.fn()
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

  class NWCClient {
    relayUrls = ['wss://relay.test']
    pool = {
      listConnectionStatus: () =>
        new Map([['wss://relay.test/', control.connected]])
    }
    get connected() {
      return control.connected
    }
    constructor(_options: unknown) {}
    async subscribeNotifications() {
      return () => {}
    }
    getInfo() {
      return control.getInfo()
    }
    listTransactions() {
      return Promise.resolve({ transactions: [], total_count: 0 })
    }
    close() {}
  }

  return { NWCClient, Nip47Error, Nip47WalletError, Nip47TimeoutError }
})

import { Nip47Error, Nip47TimeoutError } from '@getalby/sdk'
import type { NWCClient } from '@getalby/sdk'
import { NwcPool } from '../src/nwc/pool'
import { DeadWalletProber } from '../src/nwc/dead-prober'
import { metrics } from '../src/metrics'

const log = pino({ level: 'silent' })

const wallet: DesiredWallet = {
  id: 'wallet-1',
  name: 'LNCurl wallet',
  userId: 'user-1',
  connectionString: 'nostr+walletconnect://pk?relay=wss://relay.test&secret=s'
}

// Most tests use confirmation=1 (a single timeout reports) to isolate the
// probe classification; the streak tests pass their own env.
const fakeEnv = {
  DEAD_THRESHOLD_HOURS: 4,
  DEAD_PROBE_TIMEOUT_MS: 30,
  DEAD_CONFIRMATION_PROBES: 1
}

// A minimal NwcPool stand-in exposing only what the prober touches.
function fakePool(opts: {
  candidates: Array<{
    wallet: DesiredWallet
    client: NWCClient
    unresponsiveMs: number
  }>
  relaysConnected?: boolean
  holdsClient?: boolean
}) {
  const subscribed = opts.candidates.map(c => ({
    wallet: c.wallet,
    client: c.client
  }))
  return {
    deadCandidates: vi.fn(() => opts.candidates),
    subscribedClients: vi.fn(() => subscribed),
    relaysConnected: vi.fn(() => opts.relaysConnected ?? true),
    holdsClient: vi.fn(() => opts.holdsClient ?? true),
    markResponsive: vi.fn()
  }
}

function makeProber(
  pool: unknown,
  dispatcher: unknown,
  envOverride?: Record<string, number>
) {
  return new DeadWalletProber({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: { ...fakeEnv, ...envOverride } as any,
    log,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: pool as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatcher: dispatcher as any,
    metrics
  })
}

const candidate = (client: NWCClient) => ({
  wallet,
  client,
  unresponsiveMs: 5 * 60 * 60 * 1000
})

function resetMetrics() {
  metrics.deadProbesRun = 0
  metrics.deadProbesTimedOut = 0
  metrics.walletsDeclaredDead = 0
}

describe('DeadWalletProber.evaluate', () => {
  beforeEach(() => {
    control.connected = true
    control.getInfo.mockReset()
    resetMetrics()
  })

  it('reports wallet_dead once when a probe times out with relays up', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {})) // never replies
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
    expect(dispatcher.sendWalletDead).toHaveBeenCalledWith('wallet-1', 5 * 3600)
    expect(metrics.walletsDeclaredDead).toBe(1)
    expect(metrics.deadProbesTimedOut).toBe(1)

    // Second sweep with the SAME candidate still present must NOT re-report.
    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })

  it('never reports when relays are down (network fault, not death)', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {}))
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({
      candidates: [candidate(client)],
      relaysConnected: false // relays dropped mid-probe
    })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
    expect(metrics.walletsDeclaredDead).toBe(0)
  })

  it('treats a successful probe as alive and bumps the liveness clock', async () => {
    control.getInfo.mockResolvedValue({ methods: ['pay_invoice'] })
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(pool.markResponsive).toHaveBeenCalledWith('wallet-1')
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('treats a NIP-47 error reply as alive (the wallet answered)', async () => {
    control.getInfo.mockRejectedValue(
      new Nip47Error('restricted', 'RESTRICTED')
    )
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(pool.markResponsive).toHaveBeenCalledWith('wallet-1')
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('reports when getInfo rejects with a NIP-47 timeout (no reply)', async () => {
    control.getInfo.mockRejectedValue(
      new Nip47TimeoutError('no reply', 'TIMEOUT')
    )
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })

  it('retries next sweep when web did not accept the report', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {}))
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(false) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(2)
    expect(metrics.walletsDeclaredDead).toBe(0)
  })

  it('does not treat a transport error as death (inconclusive)', async () => {
    control.getInfo.mockRejectedValue(new Error('websocket closed'))
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
    expect(pool.markResponsive).not.toHaveBeenCalled()
  })

  it('requires DEAD_CONFIRMATION_PROBES consecutive timeouts before reporting', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {})) // always times out
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher, { DEAD_CONFIRMATION_PROBES: 3 })

    await prober.evaluate()
    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled() // 2 timeouts < 3
    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1) // 3rd confirms
  })

  it('resets the streak when a probe shows life (no false archive on a blip)', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({ candidates: [candidate(client)] })
    const prober = makeProber(pool, dispatcher, { DEAD_CONFIRMATION_PROBES: 3 })

    control.getInfo.mockReturnValueOnce(new Promise(() => {})) // timeout #1
    await prober.evaluate()
    control.getInfo.mockResolvedValueOnce({ ok: true }) // alive → resets
    await prober.evaluate()
    control.getInfo.mockReturnValue(new Promise(() => {})) // timeouts again
    await prober.evaluate()
    await prober.evaluate()
    // Only 2 timeouts since the reset — still below the threshold.
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('never reports on a timeout if the pool rotated the client mid-probe', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {}))
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    // holdsClient=false → the captured client is stale (wallet was rotated).
    const pool = fakePool({
      candidates: [candidate(client)],
      holdsClient: false
    })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('a dropped relay mid-streak resets the confirmation count', async () => {
    control.getInfo.mockReturnValue(new Promise(() => {})) // always times out
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    let relaysUp = true
    const pool = {
      deadCandidates: vi.fn(() => [candidate(client)]),
      subscribedClients: vi.fn(() => [{ wallet, client }]),
      relaysConnected: vi.fn(() => relaysUp),
      holdsClient: vi.fn(() => true),
      markResponsive: vi.fn()
    }
    const prober = makeProber(pool, dispatcher, { DEAD_CONFIRMATION_PROBES: 3 })

    await prober.evaluate() // streak 1
    await prober.evaluate() // streak 2
    relaysUp = false
    await prober.evaluate() // relay flap → streak reset
    relaysUp = true
    await prober.evaluate() // streak 1
    await prober.evaluate() // streak 2
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
    await prober.evaluate() // streak 3 → confirmed dead
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })
})

describe('NwcPool.deadCandidates', () => {
  beforeEach(() => {
    control.connected = true
    control.getInfo.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags a subscribed, relay-connected wallet only after it goes stale', async () => {
    const pool = new NwcPool({ log, onNotification: vi.fn() })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(0) // flush the async connect

    // Fresh subscribe seeds lastResponsiveAt = now → not yet a candidate.
    expect(pool.deadCandidates(1000)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000) // 2s of silence
    const cands = pool.deadCandidates(1000)
    expect(cands).toHaveLength(1)
    expect(cands[0].wallet.id).toBe('wallet-1')
    expect(cands[0].unresponsiveMs).toBeGreaterThanOrEqual(2000)

    // Relays down → excluded (network fault, not death).
    control.connected = false
    expect(pool.deadCandidates(1000)).toHaveLength(0)
    control.connected = true

    // A liveness bump clears candidacy.
    pool.markResponsive('wallet-1')
    expect(pool.deadCandidates(1000)).toHaveLength(0)

    await pool.closeAll()
  })
})
