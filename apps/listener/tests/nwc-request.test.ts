import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesiredWallet } from '../src/db'

const control = vi.hoisted(() => ({
  subscribeError: null as Error | null,
  connected: true,
  getInfo: vi.fn(),
  payInvoice: vi.fn(),
  makeInvoice: vi.fn(),
  getBalance: vi.fn()
}))

vi.mock('@getalby/sdk', () => {
  class Nip47Error extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  }
  class Nip47WalletError extends Nip47Error {}
  class Nip47TimeoutError extends Nip47Error {}

  class NWCClient {
    relayUrls = ['wss://relay.test']
    // nostr-tools normalizes keys — bare domains gain a trailing slash.
    pool = {
      listConnectionStatus: () => new Map([['wss://relay.test/', true]])
    }
    get connected() {
      return control.connected
    }
    constructor(_options: unknown) {}
    async subscribeNotifications() {
      if (control.subscribeError) throw control.subscribeError
      return () => {}
    }
    payInvoice(params: unknown) {
      return control.payInvoice(params)
    }
    makeInvoice(params: unknown) {
      return control.makeInvoice(params)
    }
    getBalance() {
      return control.getBalance()
    }
    lookupInvoice() {
      return Promise.resolve({})
    }
    listTransactions() {
      return Promise.resolve({ transactions: [], total_count: 0 })
    }
    getInfo() {
      return control.getInfo()
    }
    close() {}
  }

  return { NWCClient, Nip47Error, Nip47WalletError, Nip47TimeoutError }
})

import { Nip47WalletError } from '@getalby/sdk'
import { NwcPool, NwcPoolError } from '../src/nwc/pool'

const CS = 'nostr+walletconnect://pubkey?relay=wss://relay.test&secret=s'

const wallet: DesiredWallet = {
  id: 'wallet-1',
  name: 'Test wallet',
  userId: 'user-1',
  connectionString: CS
}

const makePool = () =>
  new NwcPool({
    log: pino({ level: 'silent' }),
    onNotification: vi.fn()
  })

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('NwcPool.request', () => {
  beforeEach(() => {
    control.subscribeError = null
    control.connected = true
    control.getInfo.mockReset().mockResolvedValue({})
    control.payInvoice.mockReset()
    control.makeInvoice.mockReset()
    control.getBalance.mockReset()
  })

  it('dispatches pay_invoice through the pooled client', async () => {
    control.payInvoice.mockResolvedValue({ preimage: 'p', fees_paid: 1000 })
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const result = await pool.request(
      CS,
      'pay_invoice',
      { invoice: 'lnbc1' },
      1000
    )
    expect(result).toEqual({ preimage: 'p', fees_paid: 1000 })
    expect(control.payInvoice).toHaveBeenCalledWith({ invoice: 'lnbc1' })
    await pool.closeAll()
  })

  it('routes each method to the matching client call', async () => {
    control.getBalance.mockResolvedValue({ balance: 5000 })
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    await expect(pool.request(CS, 'get_balance', {}, 1000)).resolves.toEqual({
      balance: 5000
    })
    await pool.closeAll()
  })

  it('throws wallet_not_found for unknown connection strings', async () => {
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const err = (await pool
      .request('nostr+walletconnect://other', 'get_balance', {}, 1000)
      .catch((e: unknown) => e)) as NwcPoolError
    expect(err).toBeInstanceOf(NwcPoolError)
    expect(err.code).toBe('wallet_not_found')
    await pool.closeAll()
  })

  it('throws wallet_not_connected while the connection is down', async () => {
    control.subscribeError = new Error('relay unreachable')
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const err = (await pool
      .request(CS, 'get_balance', {}, 1000)
      .catch((e: unknown) => e)) as NwcPoolError
    expect(err).toBeInstanceOf(NwcPoolError)
    expect(err.code).toBe('wallet_not_connected')
    await pool.closeAll()
  })

  it('maps Nip47WalletError to a final wallet_error with the NIP-47 code', async () => {
    control.payInvoice.mockRejectedValue(
      new Nip47WalletError('not enough sats', 'INSUFFICIENT_BALANCE')
    )
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const err = (await pool
      .request(CS, 'pay_invoice', { invoice: 'lnbc1' }, 1000)
      .catch((e: unknown) => e)) as NwcPoolError
    expect(err).toBeInstanceOf(NwcPoolError)
    expect(err.code).toBe('wallet_error')
    expect(err.walletErrorCode).toBe('INSUFFICIENT_BALANCE')
    await pool.closeAll()
  })

  it('times out hung requests with code timeout', async () => {
    control.payInvoice.mockReturnValue(new Promise(() => {}))
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const err = (await pool
      .request(CS, 'pay_invoice', { invoice: 'lnbc1' }, 50)
      .catch((e: unknown) => e)) as NwcPoolError
    expect(err).toBeInstanceOf(NwcPoolError)
    expect(err.code).toBe('timeout')
    await pool.closeAll()
  })

  it('reports wallet state + relays in snapshot and relaySummary', async () => {
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    const [snapshot] = pool.snapshot()
    expect(snapshot.walletId).toBe('wallet-1')
    expect(snapshot.state).toBe('ready')
    expect(snapshot.relayUrls).toEqual(['wss://relay.test'])

    expect(pool.relaySummary()).toEqual([
      { url: 'wss://relay.test/', connected: true, walletCount: 1 }
    ])
    await pool.closeAll()
  })
})

describe('NwcPool connection hooks', () => {
  it('stays negotiating until get_info proves the client is usable', async () => {
    let finishWarmup!: (value: unknown) => void
    control.getInfo.mockReturnValue(
      new Promise(resolve => {
        finishWarmup = resolve
      })
    )
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    expect(pool.snapshot()[0].state).toBe('negotiating')
    await expect(
      pool.requestByWalletId('wallet-1', 'get_balance', {}, 1000)
    ).rejects.toMatchObject({ code: 'wallet_not_connected' })

    finishWarmup({ methods: ['pay_invoice'] })
    await flush()
    expect(pool.snapshot()[0].state).toBe('ready')
    await pool.closeAll()
  })

  it('treats a wallet-level get_info rejection as transport readiness', async () => {
    control.getInfo.mockRejectedValue(
      new Nip47WalletError('restricted', 'RESTRICTED')
    )
    const pool = makePool()
    await pool.reconcile([wallet])
    await flush()

    expect(pool.snapshot()[0].state).toBe('ready')
    await pool.closeAll()
  })

  it('fires onSubscribed after subscribing and onReconnected on a connectivity flip', async () => {
    control.subscribeError = null
    control.connected = true
    control.getInfo.mockReset().mockResolvedValue({})
    vi.useFakeTimers()
    try {
      const onSubscribed = vi.fn()
      const onReconnected = vi.fn()
      const pool = new NwcPool({
        log: pino({ level: 'silent' }),
        onNotification: vi.fn(),
        onSubscribed,
        onReconnected
      })
      await pool.reconcile([wallet])
      await vi.advanceTimersByTimeAsync(0)

      expect(onSubscribed).toHaveBeenCalledTimes(1)
      expect(onSubscribed.mock.calls[0][0].id).toBe('wallet-1')

      // Relay drops: the watcher records the down state...
      control.connected = false
      await vi.advanceTimersByTimeAsync(30000)
      expect(onReconnected).not.toHaveBeenCalled()

      // ...and fires exactly once on the false → true edge.
      control.connected = true
      await vi.advanceTimersByTimeAsync(30000)
      expect(onReconnected).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30000)
      expect(onReconnected).toHaveBeenCalledTimes(1)

      await pool.closeAll()
    } finally {
      vi.useRealTimers()
    }
  })
})
