import { afterEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { Logger } from 'pino'
import {
  isValidConnectionString,
  loadActiveNwcWallets,
  waitForSchema
} from '../src/db'
import type { ListenerEnv } from '../src/env'
import { encryptRemoteWalletEnvelope } from '../../web/lib/wallet/remote-wallet-vault-core'

const NWC_VAULT_SECRET =
  'listener-remote-wallet-secret-0123456789abcdef0123456789abcd'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

const logMock = () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return log as unknown as Logger & typeof log
}

describe('waitForSchema', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediately once RemoteWallet exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ reg: 'RemoteWallet' }] })
    const pool = { query } as unknown as pg.Pool
    await waitForSchema(pool, logMock())
    expect(query).toHaveBeenCalledTimes(1)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain(`to_regclass('"RemoteWallet"')`)
  })

  it('polls until the table appears, logging while waiting', async () => {
    vi.useFakeTimers()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ reg: null }] })
      .mockResolvedValueOnce({ rows: [{ reg: null }] })
      .mockResolvedValueOnce({ rows: [{ reg: 'RemoteWallet' }] })
    const pool = { query } as unknown as pg.Pool
    const log = logMock()

    const done = waitForSchema(pool, log)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    await done

    expect(query).toHaveBeenCalledTimes(3)
    expect(log.info).toHaveBeenCalledWith(
      { attempt: 1 },
      'db.waiting_for_web_migrations'
    )
    expect(log.info).toHaveBeenCalledWith(
      { attempt: 2 },
      'db.waiting_for_web_migrations'
    )
  })

  it('throws after 60 attempts if the table never appears', async () => {
    vi.useFakeTimers()
    const query = vi.fn().mockResolvedValue({ rows: [{ reg: null }] })
    const pool = { query } as unknown as pg.Pool

    let failure: unknown = null
    const done = waitForSchema(pool, logMock()).catch(err => {
      failure = err
    })
    await vi.advanceTimersByTimeAsync(60 * 2000)
    await done

    expect(query).toHaveBeenCalledTimes(60)
    expect(String(failure)).toContain('never appeared')
  })
})

describe('loadActiveNwcWallets', () => {
  it('decrypts RemoteWallet rows before adding them to the pool', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'wallet-1',
            name: 'Primary',
            userId: 'user-1',
            connectionString: encryptRemoteWalletEnvelope(
              NWC_URI,
              'wallet-1',
              NWC_VAULT_SECRET
            )
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }) // no proxy wallet
    const pool = { query } as unknown as pg.Pool
    const env = {
      DATABASE_URL: 'postgresql://test',
      LISTENER_AUTH_SECRET: 'listener-secret-0123456789abcdef',
      WEB_ORIGIN: 'https://lawallet.example',
      NWC_VAULT_SECRET
    } as ListenerEnv

    await expect(loadActiveNwcWallets(pool, logMock(), env)).resolves.toEqual([
      {
        id: 'wallet-1',
        name: 'Primary',
        userId: 'user-1',
        connectionString: NWC_URI
      }
    ])
  })
})

describe('isValidConnectionString', () => {
  it('requires valid keys and at least one ws(s) relay', () => {
    expect(isValidConnectionString(NWC_URI)).toBe(true)
    expect(
      isValidConnectionString(
        `nostr+walletconnect://${'a'.repeat(32)} ${'b'.repeat(32)}?relay=wss%3A%2F%2Frelay.example&secret=${'c'.repeat(64)}`
      )
    ).toBe(false)
    expect(
      isValidConnectionString(
        `nostr+walletconnect://${'a'.repeat(64)}?relay=https%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`
      )
    ).toBe(false)
  })
})
