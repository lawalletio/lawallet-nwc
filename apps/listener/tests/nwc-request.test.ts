import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesiredWallet } from '../src/db'

const control = vi.hoisted(() => ({
  subscribeError: null as Error | null,
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
    pool = { listConnectionStatus: () => new Map([['wss://relay.test', true]]) }
    get connected() {
      return true
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
      return Promise.resolve({})
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
    expect(snapshot.state).toBe('subscribed')
    expect(snapshot.relayUrls).toEqual(['wss://relay.test'])

    expect(pool.relaySummary()).toEqual([
      { url: 'wss://relay.test', connected: true, walletCount: 1 }
    ])
    await pool.closeAll()
  })
})
