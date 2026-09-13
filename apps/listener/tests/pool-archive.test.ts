import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesiredWallet } from '../src/db'

const control = vi.hoisted(() => ({
  /** Set to make `getInfo()` (the warm-up round-trip) fail. */
  warmupError: null as Error | null,
  connects: 0
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
      listConnectionStatus: () => new Map([['wss://relay.test/', true]])
    }
    get connected() {
      return true
    }
    constructor(_options: unknown) {
      control.connects++
    }
    async subscribeNotifications() {
      return () => {}
    }
    async getInfo() {
      if (control.warmupError) throw control.warmupError
      return { methods: ['pay_invoice'] }
    }
    close() {}
  }

  return { NWCClient, Nip47Error, Nip47WalletError, Nip47TimeoutError }
})

import { NwcPool } from '../src/nwc/pool'

const log = pino({ level: 'silent' })

const wallet: DesiredWallet = {
  id: 'wallet-1',
  name: 'Warmup-stuck wallet',
  userId: 'user-1',
  connectionString: 'nostr+walletconnect://pk?relay=wss://relay.test&secret=s'
}

/** Warm-up failures classified as retryable — the LAWALLET-LISTENER-1/2 shape. */
const WARMUP_FAILURE = new Error(
  'no info event (kind 13194) returned from relay'
)

describe('NwcPool — warmup-stuck wallets reach the archive path', () => {
  beforeEach(() => {
    control.warmupError = null
    control.connects = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes a never-ready wallet in livenessSnapshot (deadCandidates cannot)', async () => {
    control.warmupError = WARMUP_FAILURE
    const pool = new NwcPool({ log, onNotification: vi.fn() })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(0)

    // The probe path only ever sees `ready` wallets, which is exactly why
    // warmup failures used to be unreachable from archival.
    expect(pool.deadCandidates(0)).toHaveLength(0)

    const snapshot = pool.livenessSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      state: 'error',
      everReady: false,
      lastResponsiveAt: null,
      parked: false
    })

    await pool.closeAll()
  })

  it('retries a failing warm-up until parked, then only once per archive window', async () => {
    control.warmupError = WARMUP_FAILURE
    const PARK_MS = 6 * 60 * 60 * 1000
    const pool = new NwcPool({ log, onNotification: vi.fn() })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(0)

    // Backoff climbs to a 60s ceiling: a stuck wallet reconnects forever.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const beforePark = control.connects
    expect(beforePark).toBeGreaterThan(3)

    pool.parkWallet('wallet-1', PARK_MS)
    expect(pool.livenessSnapshot()[0].parked).toBe(true)

    // Nothing at all for the whole window — no relay traffic, no Sentry churn.
    await vi.advanceTimersByTimeAsync(PARK_MS - 1000)
    expect(control.connects).toBe(beforePark)

    // Exactly one attempt when the window elapses.
    await vi.advanceTimersByTimeAsync(2000)
    expect(control.connects).toBe(beforePark + 1)

    // That attempt fails too, and the backoff resumes at its 60s ceiling
    // instead of restarting from 1s — the pre-park storm must not come back.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(control.connects).toBe(beforePark + 1)

    await pool.closeAll()
  })

  it('keeps warm-up errors out of Sentry once web was told the wallet is dead', async () => {
    control.warmupError = WARMUP_FAILURE
    const onWalletError = vi.fn()
    const pool = new NwcPool({
      log,
      onNotification: vi.fn(),
      onWalletError,
      // Backed by the persisted archive_reported_at flag, so this holds after a
      // restart too — the report cannot storm Sentry a second time.
      isArchiveReported: () => true
    })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(onWalletError).not.toHaveBeenCalled()

    await pool.closeAll()
  })

  it('still reports warm-up failures for a wallet that was never declared dead', async () => {
    control.warmupError = WARMUP_FAILURE
    const onWalletError = vi.fn()
    const pool = new NwcPool({
      log,
      onNotification: vi.fn(),
      onWalletError,
      isArchiveReported: () => false
    })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(onWalletError).toHaveBeenCalledTimes(1)

    await pool.closeAll()
  })

  it('mirrors proof of life to the durable clock, flagging warm-up completion', async () => {
    const onLiveness = vi.fn()
    const pool = new NwcPool({ log, onNotification: vi.fn(), onLiveness })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(0)

    expect(onLiveness).toHaveBeenCalledWith('wallet-1', expect.any(Date), true)
    expect(pool.livenessSnapshot()[0]).toMatchObject({
      state: 'ready',
      everReady: true
    })

    onLiveness.mockClear()
    pool.markResponsive('wallet-1')
    expect(onLiveness).toHaveBeenCalledWith('wallet-1', expect.any(Date), false)

    await pool.closeAll()
  })

  it('un-parks on a foreground demand for the wallet', async () => {
    control.warmupError = WARMUP_FAILURE
    const pool = new NwcPool({ log, onNotification: vi.fn() })
    await pool.reconcile([wallet])
    await vi.advanceTimersByTimeAsync(0)

    pool.parkWallet('wallet-1', 6 * 60 * 60 * 1000)
    const parkedAt = control.connects

    // A card payment needs this wallet now — the archive backoff must yield.
    pool.prioritizeWallet('wallet-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(control.connects).toBe(parkedAt + 1)
    expect(pool.livenessSnapshot()[0].parked).toBe(false)

    await pool.closeAll()
  })
})
