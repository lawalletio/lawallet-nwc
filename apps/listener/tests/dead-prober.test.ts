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
import type pg from 'pg'
import { NwcPool, type WalletLivenessSnapshot } from '../src/nwc/pool'
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
  DEAD_CONFIRMATION_PROBES: 1,
  WALLET_ARCHIVE_IDLE_HOURS: 48,
  WALLET_ARCHIVE_RETRY_MS: 6 * 60 * 60 * 1000
}

const HOUR_MS = 60 * 60 * 1000

/** One `livenessSnapshot()` entry for a wallet the pool is holding. */
function livenessEntry(
  overrides: Partial<WalletLivenessSnapshot> = {}
): WalletLivenessSnapshot {
  return {
    wallet,
    state: 'error',
    everReady: false,
    lastResponsiveAt: null,
    parked: false,
    retryAttempt: 1,
    ...overrides
  }
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
  foregroundPayment?: boolean
  liveness?: WalletLivenessSnapshot[]
  /** What `isReady()` reports at report time (the final anti-race re-check). */
  ready?: boolean
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
    hasForegroundPayment: vi.fn(() => opts.foregroundPayment ?? false),
    markResponsive: vi.fn(),
    livenessSnapshot: vi.fn(() => opts.liveness ?? []),
    parkWallet: vi.fn(),
    isReady: vi.fn(() => opts.ready ?? false)
  }
}

/**
 * Stand-in for the shared Postgres. `liveness` seeds what
 * `loadWalletLiveness` returns; every write is recorded so tests can assert
 * the durable clock is being kept.
 */
function fakeDb(
  liveness: Array<{
    wallet_id: string
    last_active_at: Date
    ready_at: Date | null
    archive_reported_at: Date | null
  }> = []
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM listener.wallet_cursors')) {
      return { rows: liveness, rowCount: liveness.length }
    }
    return { rows: [], rowCount: 1 }
  })
  return { db: { query } as unknown as pg.Pool, query }
}

function makeProber(
  pool: unknown,
  dispatcher: unknown,
  envOverride?: Record<string, number>,
  db: pg.Pool = fakeDb().db,
  onArchiveReported?: (walletId: string) => void
) {
  return new DeadWalletProber({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: { ...fakeEnv, ...envOverride } as any,
    log,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: pool as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatcher: dispatcher as any,
    metrics,
    db,
    onArchiveReported
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
  metrics.walletsArchiveRequested = 0
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
    expect(dispatcher.sendWalletDead).toHaveBeenCalledWith(
      'wallet-1',
      5 * 3600,
      {
        reason: 'unresponsive',
        relaysConnected: true,
        everReady: true
      }
    )
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

  it('defers maintenance probes while a card payment is in flight', async () => {
    control.getInfo.mockResolvedValue({ methods: ['pay_invoice'] })
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { getInfo: () => control.getInfo() } as any
    const pool = fakePool({
      candidates: [candidate(client)],
      foregroundPayment: true
    })
    const prober = makeProber(pool, dispatcher)

    await prober.evaluate()
    expect(control.getInfo).not.toHaveBeenCalled()
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
      hasForegroundPayment: vi.fn(() => false),
      markResponsive: vi.fn(),
      livenessSnapshot: vi.fn(() => []),
      parkWallet: vi.fn(),
      isReady: vi.fn(() => false)
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

/**
 * The 48h rule (issue #279). These wallets are NOT probe candidates — a
 * warmup-stuck wallet has no live client at all — so before this path they
 * retried every 60s forever and never reached archival.
 */
describe('DeadWalletProber — 48h idle archive', () => {
  beforeEach(() => {
    control.connected = true
    control.getInfo.mockReset()
    resetMetrics()
  })

  it('archives a warmup-stuck wallet (error, never ready) idle past 48h', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    const { db, query } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 49 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const reported: string[] = []
    const prober = makeProber(pool, dispatcher, undefined, db, id =>
      reported.push(id)
    )

    await prober.evaluate()

    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
    const [walletId, seconds, opts] = dispatcher.sendWalletDead.mock.calls[0]
    expect(walletId).toBe('wallet-1')
    expect(seconds).toBeGreaterThanOrEqual(49 * 3600)
    expect(opts).toMatchObject({ reason: 'warmup_failed', everReady: false })
    expect(metrics.walletsArchiveRequested).toBe(1)
    // Retry storm stops: the wallet is parked at the archive retry interval.
    expect(pool.parkWallet).toHaveBeenCalledWith(
      'wallet-1',
      fakeEnv.WALLET_ARCHIVE_RETRY_MS
    )
    // The report is durable, so a restart doesn't re-report (or re-Sentry).
    expect(reported).toEqual(['wallet-1'])
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('archive_reported_at = $2')
      )
    ).toBe(true)
  })

  it('reports `idle` (not `warmup_failed`) for a wallet that was ready before', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'disconnected' })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: new Date(Date.now() - 80 * HOUR_MS),
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead.mock.calls[0][2]).toMatchObject({
      reason: 'idle',
      everReady: true
    })
  })

  it('leaves a wallet alone until the 48h window is cleared', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 47 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
    expect(pool.parkWallet).not.toHaveBeenCalled()
  })

  it('uses the PERSISTED clock, so a restart cannot reset idleness', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    // Fresh process: nothing in memory has ever proven this wallet alive.
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error', lastResponsiveAt: null })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 5 * 24 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })

  it('honours in-memory proof of life over a stale persisted clock', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [
        livenessEntry({
          state: 'disconnected',
          everReady: true,
          lastResponsiveAt: new Date(Date.now() - 60_000)
        })
      ]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 5 * 24 * HOUR_MS),
        ready_at: new Date(Date.now() - 5 * 24 * HOUR_MS),
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('does not re-report inside the persisted throttle window (restart-safe)', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: new Date(Date.now() - 60_000)
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
    // Still parked, so the wallet isn't hammering relays while it waits.
    expect(pool.parkWallet).toHaveBeenCalledWith(
      'wallet-1',
      fakeEnv.WALLET_ARCHIVE_RETRY_MS
    )
  })

  it('re-reports once the throttle window has elapsed', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: new Date(Date.now() - 7 * HOUR_MS)
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })

  it('never archives a wallet still on its first handshake', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'connecting', retryAttempt: 0 })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  // A warmup-stuck wallet spends part of every retry cycle back in
  // `connecting`, so candidacy must not depend on catching it in `error`.
  it('archives a retrying wallet even when the sweep lands mid-reconnect', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'connecting', retryAttempt: 7 })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).toHaveBeenCalledTimes(1)
  })

  it('aborts the report if the retry succeeded while the ledger was read', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'connecting', retryAttempt: 7 })],
      // The wallet answered between the snapshot and the report.
      ready: true
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('does not park when web refused the report', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(false) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: null,
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(pool.parkWallet).not.toHaveBeenCalled()
    expect(metrics.walletsArchiveRequested).toBe(0)
  })

  it('defers to an in-flight card payment', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      foregroundPayment: true,
      liveness: [livenessEntry({ state: 'disconnected', everReady: true })]
    })
    const { db } = fakeDb([
      {
        wallet_id: 'wallet-1',
        last_active_at: new Date(Date.now() - 72 * HOUR_MS),
        ready_at: new Date(Date.now() - 72 * HOUR_MS),
        archive_reported_at: null
      }
    ])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
  })

  it('anchors the idle clock for a wallet that has never proven anything', async () => {
    const dispatcher = { sendWalletDead: vi.fn().mockResolvedValue(true) }
    const pool = fakePool({
      candidates: [],
      liveness: [livenessEntry({ state: 'error' })]
    })
    // No persisted row yet — a brand-new wallet failing its first warm-up.
    const { db, query } = fakeDb([])
    const prober = makeProber(pool, dispatcher, undefined, db)

    await prober.evaluate()
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('last_active_at IS NULL')
      )
    ).toBe(true)
    // Nothing to archive: the clock starts now, not 48h ago.
    expect(dispatcher.sendWalletDead).not.toHaveBeenCalled()
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
