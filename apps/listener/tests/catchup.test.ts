import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { NWCClient } from '@getalby/sdk'
import type { DesiredWallet } from '../src/db'
import type { ListenerEnv } from '../src/env'
import { CatchupRunner, planCatchupWindow } from '../src/nwc/catchup'

vi.mock('../src/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/store')>()
  return {
    ...actual,
    getCursor: vi.fn(),
    seedCursorIfMissing: vi.fn(),
    advanceCursor: vi.fn()
  }
})

vi.mock('@getalby/sdk', () => {
  class Nip47Error extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  }
  class Nip47WalletError extends Nip47Error {}
  return { Nip47Error, Nip47WalletError }
})

import { Nip47WalletError } from '@getalby/sdk'
import { advanceCursor, getCursor, seedCursorIfMissing } from '../src/store'

const env = {
  CATCHUP_ENABLED: true,
  CATCHUP_MAX_WINDOW_HOURS: 24,
  CATCHUP_OVERLAP_SECONDS: 300,
  CATCHUP_INTERVAL_MS: 0
} as ListenerEnv

const wallet: DesiredWallet = {
  id: 'wallet-1',
  name: 'Alice wallet',
  userId: 'user-1',
  connectionString: 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s'
}

const freshMetrics = () => ({
  startedAt: new Date(),
  eventsReceived: 0,
  eventsDuplicate: 0,
  webhooksDelivered: 0,
  webhooksFailed: 0,
  webhooksPending: 0,
  nwcRequests: 0,
  nwcRequestErrors: 0,
  nwcPayments: 0,
  nwcPaymentDuplicates: 0,
  nwcPaymentsPending: 0,
  reconciles: 0,
  notifiesReceived: 0,
  eventsRecovered: 0,
  catchupRuns: 0,
  catchupErrors: 0,
  deadProbesRun: 0,
  deadProbesTimedOut: 0,
  walletsDeclaredDead: 0
})

const settledTx = (
  hash: string,
  type: 'incoming' | 'outgoing' = 'incoming'
) => ({
  type,
  state: 'settled',
  payment_hash: hash,
  amount: 21000,
  fees_paid: 0,
  settled_at: Math.floor(Date.now() / 1000),
  created_at: Math.floor(Date.now() / 1000),
  invoice: 'lnbc1',
  description: '',
  description_hash: '',
  preimage: 'p',
  expires_at: 0
})

/** Minimal NWCClient stand-in: listTransactions + relay-replay surface. */
function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    walletPubkey: 'wallet-pubkey',
    publicKey: 'client-pubkey',
    relayUrls: ['wss://relay.test'],
    listTransactions: vi
      .fn()
      .mockResolvedValue({ transactions: [], total_count: 0 }),
    decrypt: vi.fn(),
    pool: {
      subscribe: vi.fn((_relays, _filter, params) => {
        // Default: empty relay — immediate EOSE.
        params.oneose?.()
        return { close: vi.fn() }
      })
    },
    ...overrides
  } as unknown as NWCClient
}

function makeRunner(
  processImpl?: (w: unknown, n: unknown) => Promise<boolean>
) {
  const metrics = freshMetrics()
  const process = vi.fn(processImpl ?? (async () => true))
  const runner = new CatchupRunner({
    env,
    log: pino({ level: 'silent' }),
    pool: { query: vi.fn() } as unknown as pg.Pool,
    metrics,
    process: process as never
  })
  return { runner, metrics, process }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('planCatchupWindow', () => {
  const now = new Date('2026-07-05T12:00:00Z')
  const HOUR = 60 * 60 * 1000

  it('returns null without a cursor (caller seeds instead of backfilling)', () => {
    expect(
      planCatchupWindow({
        cursor: null,
        now,
        maxWindowMs: 24 * HOUR,
        overlapMs: 300_000
      })
    ).toBeNull()
  })

  it('anchors from = cursor − overlap for a recent cursor', () => {
    const cursor = new Date(now.getTime() - HOUR)
    const window = planCatchupWindow({
      cursor,
      now,
      maxWindowMs: 24 * HOUR,
      overlapMs: 300_000
    })
    expect(window?.fromSec).toBe(
      Math.floor((cursor.getTime() - 300_000) / 1000)
    )
    expect(window?.untilSec).toBe(Math.ceil(now.getTime() / 1000))
  })

  it('floors the window at now − maxWindow for a stale cursor', () => {
    const cursor = new Date(now.getTime() - 100 * HOUR)
    const window = planCatchupWindow({
      cursor,
      now,
      maxWindowMs: 24 * HOUR,
      overlapMs: 300_000
    })
    expect(window?.fromSec).toBe(Math.floor((now.getTime() - 24 * HOUR) / 1000))
  })

  it('returns null when the window would be empty or inverted', () => {
    expect(
      planCatchupWindow({
        cursor: new Date(now.getTime() + HOUR),
        now,
        maxWindowMs: 24 * HOUR,
        overlapMs: 0
      })
    ).toBeNull()
  })
})

describe('CatchupRunner.runForWallet', () => {
  it('seeds the cursor on first sight without importing history', async () => {
    vi.mocked(getCursor).mockResolvedValue(null)
    const { runner, process } = makeRunner()
    const client = fakeClient()

    await runner.runForWallet(wallet, client)

    expect(seedCursorIfMissing).toHaveBeenCalledWith(
      expect.anything(),
      wallet.id,
      expect.any(Date)
    )
    expect(client.listTransactions).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it('recovers settled transactions across pages and advances the cursor', async () => {
    vi.mocked(getCursor).mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    )
    const page1 = Array.from({ length: 50 }, (_, i) =>
      settledTx(`${i}`.padStart(64, 'a'))
    )
    const page2 = [
      settledTx('b'.repeat(64), 'outgoing'),
      { ...settledTx('c'.repeat(64)), state: 'pending' }
    ]
    const listTransactions = vi
      .fn()
      .mockResolvedValueOnce({ transactions: page1, total_count: 52 })
      .mockResolvedValueOnce({ transactions: page2, total_count: 52 })
    const { runner, metrics, process } = makeRunner()
    const client = fakeClient({ listTransactions })

    await runner.runForWallet(wallet, client)

    expect(listTransactions).toHaveBeenCalledTimes(2)
    expect(listTransactions.mock.calls[1][0].offset).toBe(50)
    // 50 settled + 1 settled outgoing; the pending one is skipped
    expect(process).toHaveBeenCalledTimes(51)
    const types = process.mock.calls.map(
      ([, n]) => (n as { notification_type: string }).notification_type
    )
    expect(types.filter(t => t === 'payment_sent')).toHaveLength(1)
    expect(metrics.eventsRecovered).toBe(51)
    expect(metrics.catchupRuns).toBe(1)
    expect(advanceCursor).toHaveBeenCalledWith(
      expect.anything(),
      wallet.id,
      expect.any(Date)
    )
  })

  it('only counts NEW events (dedup hits excluded) as recovered', async () => {
    vi.mocked(getCursor).mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    )
    const listTransactions = vi.fn().mockResolvedValue({
      transactions: [settledTx('a'.repeat(64)), settledTx('b'.repeat(64))],
      total_count: 2
    })
    const { runner, metrics } = makeRunner(async (_w, n) => {
      // First is a dedup hit, second is new.
      return (
        n as { notification: { payment_hash: string } }
      ).notification.payment_hash.startsWith('b')
    })
    await runner.runForWallet(wallet, fakeClient({ listTransactions }))
    expect(metrics.eventsRecovered).toBe(1)
  })

  it('marks NOT_IMPLEMENTED wallets and still runs the relay path', async () => {
    vi.mocked(getCursor).mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    )
    const listTransactions = vi
      .fn()
      .mockRejectedValue(new Nip47WalletError('nope', 'NOT_IMPLEMENTED'))
    const subscribe = vi.fn((_relays, _filter, params) => {
      params.oneose?.()
      return { close: vi.fn() }
    })
    const { runner, metrics } = makeRunner()
    const client = fakeClient({ listTransactions, pool: { subscribe } })

    await runner.runForWallet(wallet, client)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(metrics.catchupErrors).toBe(0)
    expect(advanceCursor).toHaveBeenCalled()

    // Second run skips list_transactions entirely (marked unsupported)...
    await runner.runForWallet(wallet, client)
    expect(listTransactions).toHaveBeenCalledTimes(1)

    // ...until the periodic reconcile resets the marker.
    runner.resetUnsupported()
    await runner.runForWallet(wallet, client)
    expect(listTransactions).toHaveBeenCalledTimes(2)
  })

  it('does NOT advance the cursor when the wallet path fails hard', async () => {
    vi.mocked(getCursor).mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    )
    const listTransactions = vi
      .fn()
      .mockRejectedValue(new Error('network down'))
    const { runner, metrics } = makeRunner()

    await runner.runForWallet(wallet, fakeClient({ listTransactions }))

    expect(metrics.catchupErrors).toBe(1)
    expect(advanceCursor).not.toHaveBeenCalled()
  })

  it('is a no-op while a run for the same wallet is in flight', async () => {
    vi.mocked(getCursor).mockResolvedValue(
      new Date(Date.now() - 60 * 60 * 1000)
    )
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const listTransactions = vi.fn().mockImplementation(async () => {
      await gate
      return { transactions: [], total_count: 0 }
    })
    const { runner } = makeRunner()
    const client = fakeClient({ listTransactions })

    const first = runner.runForWallet(wallet, client)
    const second = runner.runForWallet(wallet, client)
    release()
    await Promise.all([first, second])

    expect(listTransactions).toHaveBeenCalledTimes(1)
  })

  describe('relay replay', () => {
    const encrypted = (id: string) => ({
      id,
      pubkey: 'wallet-pubkey',
      content: `enc-${id}`,
      kind: 23197,
      created_at: Math.floor(Date.now() / 1000),
      tags: []
    })

    it('decrypts replayed events and feeds them through the pipeline', async () => {
      vi.mocked(getCursor).mockResolvedValue(
        new Date(Date.now() - 60 * 60 * 1000)
      )
      const subscribe = vi.fn((_relays, filter, params) => {
        expect(filter.kinds).toEqual([23196, 23197])
        expect(typeof filter.since).toBe('number')
        params.onevent(encrypted('e1'))
        params.oneose?.()
        return { close: vi.fn() }
      })
      const decrypt = vi.fn().mockResolvedValue(
        JSON.stringify({
          notification_type: 'payment_received',
          notification: settledTx('d'.repeat(64))
        })
      )
      const { runner, metrics, process } = makeRunner()
      await runner.runForWallet(
        wallet,
        fakeClient({ pool: { subscribe }, decrypt })
      )

      expect(decrypt).toHaveBeenCalledWith('wallet-pubkey', 'enc-e1')
      expect(process).toHaveBeenCalledTimes(1)
      expect(metrics.eventsRecovered).toBe(1)
    })

    it('skips events that fail to decrypt without failing the run', async () => {
      vi.mocked(getCursor).mockResolvedValue(
        new Date(Date.now() - 60 * 60 * 1000)
      )
      const subscribe = vi.fn((_relays, _filter, params) => {
        params.onevent(encrypted('bad'))
        params.oneose?.()
        return { close: vi.fn() }
      })
      const decrypt = vi.fn().mockRejectedValue(new Error('foreign encryption'))
      const { runner, metrics, process } = makeRunner()

      await runner.runForWallet(
        wallet,
        fakeClient({ pool: { subscribe }, decrypt })
      )

      expect(process).not.toHaveBeenCalled()
      expect(metrics.catchupErrors).toBe(0)
      expect(advanceCursor).toHaveBeenCalled()
    })

    it('survives a relay pool that throws on subscribe', async () => {
      vi.mocked(getCursor).mockResolvedValue(
        new Date(Date.now() - 60 * 60 * 1000)
      )
      const subscribe = vi.fn(() => {
        throw new Error('no relay connection')
      })
      const { runner, metrics } = makeRunner()

      await runner.runForWallet(wallet, fakeClient({ pool: { subscribe } }))

      expect(metrics.catchupErrors).toBe(0)
      expect(advanceCursor).toHaveBeenCalled()
    })
  })
})
