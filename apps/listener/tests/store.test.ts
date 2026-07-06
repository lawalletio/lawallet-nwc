import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  advanceCursor,
  bootstrapStore,
  computeEventKey,
  getCursor,
  insertEventIfNew,
  markDelivery,
  pruneEvents,
  recentEvents,
  recentEventsSafe,
  seedCursorIfMissing,
  undeliveredEvents
} from '../src/store'

const poolWith = (result: Partial<pg.QueryResult>) => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0, ...result })
  return { pool: { query } as unknown as pg.Pool, query }
}

const event = {
  eventKey: 'key-1',
  walletId: 'wallet-1',
  notificationType: 'payment_received',
  paymentHash: 'a'.repeat(64),
  amountMsats: 21000,
  settledAt: new Date('2026-07-01T00:00:00Z'),
  payload: { amount: 21000 },
  recovered: false
}

describe('computeEventKey', () => {
  it('is deterministic and input-sensitive', () => {
    const a = computeEventKey('w1', 'payment_received', 'hash')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(computeEventKey('w1', 'payment_received', 'hash')).toBe(a)
    expect(computeEventKey('w2', 'payment_received', 'hash')).not.toBe(a)
    expect(computeEventKey('w1', 'payment_sent', 'hash')).not.toBe(a)
    expect(computeEventKey('w1', 'payment_received', 'other')).not.toBe(a)
  })
})

describe('insertEventIfNew', () => {
  it('returns true when the row was inserted', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await expect(insertEventIfNew(pool, event)).resolves.toBe(true)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('listener.processed_events')
    expect(sql).toContain('ON CONFLICT (event_key) DO NOTHING')
    expect(params[0]).toBe('key-1')
  })

  it('returns false on duplicate (conflict)', async () => {
    const { pool } = poolWith({ rowCount: 0 })
    await expect(insertEventIfNew(pool, event)).resolves.toBe(false)
  })
})

describe('markDelivery', () => {
  it('updates status, attempts and error in the listener schema', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await markDelivery(pool, 'key-1', 'failed', 3, 'HTTP 500')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('UPDATE listener.processed_events')
    expect(params).toEqual(['key-1', 'failed', 3, 'HTTP 500'])
  })
})

describe('undeliveredEvents', () => {
  it('filters by attempts cap and staleness', async () => {
    const { pool, query } = poolWith({ rows: [] })
    await undeliveredEvents(pool, {
      maxAttempts: 25,
      olderThanMs: 120000,
      limit: 50
    })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("webhook_status <> 'delivered'")
    expect(params).toEqual([25, 120000, 50])
  })
})

describe('pruneEvents', () => {
  it('deletes rows older than the retention window', async () => {
    const { pool, query } = poolWith({ rowCount: 7 })
    await expect(pruneEvents(pool, 30)).resolves.toBe(7)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('DELETE FROM listener.processed_events')
    expect(params).toEqual([30])
  })
})

describe('bootstrapStore', () => {
  it('creates the cursors table and upgrades processed_events idempotently', async () => {
    const { pool, query } = poolWith({ rowCount: 0 })
    await bootstrapStore(pool)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS listener.wallet_cursors')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS recovered')
  })
})

describe('wallet cursors', () => {
  it('getCursor returns the stored timestamp or null', async () => {
    const at = new Date('2026-07-01T00:00:00Z')
    const { pool } = poolWith({ rows: [{ last_seen_at: at }] })
    await expect(getCursor(pool, 'wallet-1')).resolves.toEqual(at)

    const { pool: empty } = poolWith({ rows: [] })
    await expect(getCursor(empty, 'wallet-1')).resolves.toBeNull()
  })

  it('seedCursorIfMissing never overwrites an existing cursor', async () => {
    const { pool, query } = poolWith({ rowCount: 0 })
    await seedCursorIfMissing(pool, 'wallet-1', new Date())
    const [sql] = query.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (wallet_id) DO NOTHING')
  })

  it('advanceCursor only moves forward (GREATEST upsert)', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await advanceCursor(pool, 'wallet-1', new Date('2026-07-01T00:00:00Z'))
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain(
      'GREATEST(listener.wallet_cursors.last_seen_at, EXCLUDED.last_seen_at)'
    )
    expect(params[0]).toBe('wallet-1')
  })
})

describe('recovered flag + wallet name', () => {
  it('insertEventIfNew persists the recovered flag', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await insertEventIfNew(pool, { ...event, recovered: true })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('recovered')
    expect(params[params.length - 1]).toBe(true)
  })

  it('recentEvents joins RemoteWallet for the display name', async () => {
    const { pool, query } = poolWith({
      rows: [
        {
          event_key: 'k',
          wallet_id: 'w1',
          notification_type: 'payment_received',
          payment_hash: null,
          amount_msats: null,
          settled_at: null,
          payload: {},
          received_at: new Date(),
          webhook_status: 'delivered',
          webhook_attempts: 1,
          recovered: true,
          wallet_name: 'Alice wallet'
        }
      ]
    })
    const [row] = await recentEvents(pool, 10)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain('LEFT JOIN "RemoteWallet"')
    expect(row.walletName).toBe('Alice wallet')
    expect(row.recovered).toBe(true)
  })

  it('recentEvents falls back to a JOIN-free query when RemoteWallet is missing (42P01)', async () => {
    const missingTable = Object.assign(
      new Error('relation "RemoteWallet" does not exist'),
      { code: '42P01' }
    )
    const query = vi
      .fn()
      .mockRejectedValueOnce(missingTable)
      .mockResolvedValueOnce({
        rows: [
          {
            event_key: 'k',
            wallet_id: 'w1',
            notification_type: 'payment_received',
            payment_hash: null,
            amount_msats: null,
            settled_at: null,
            payload: {},
            received_at: new Date(),
            webhook_status: 'delivered',
            webhook_attempts: 1,
            recovered: false
          }
        ]
      })
    const pool = { query } as unknown as pg.Pool
    const [row] = await recentEvents(pool, 10)
    const [fallbackSql] = query.mock.calls[1]
    expect(fallbackSql).not.toContain('RemoteWallet')
    expect(row.walletName).toBeNull()
  })

  it('recentEvents rethrows non-42P01 errors', async () => {
    const boom = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED'
    })
    const query = vi.fn().mockRejectedValue(boom)
    const pool = { query } as unknown as pg.Pool
    await expect(recentEvents(pool, 10)).rejects.toThrow('connection refused')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('recentEventsSafe swallows a transient DB error into an empty feed', async () => {
    // The reported /status 500 came from a non-42P01 pg error propagating out
    // of recentEvents. recentEventsSafe must NEVER reject — it degrades to []
    // so /status still returns 200 with the in-memory relay/connection view.
    const boom = Object.assign(new Error('connection reset by peer'), {
      code: '08006'
    })
    const query = vi.fn().mockRejectedValue(boom)
    const pool = { query } as unknown as pg.Pool
    const { events, error } = await recentEventsSafe(pool, 10)
    expect(events).toEqual([])
    expect(error).toBe(boom)
  })

  it('recentEventsSafe returns rows and no error on success', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          event_key: 'k',
          wallet_id: 'w1',
          notification_type: 'payment_received',
          payment_hash: null,
          amount_msats: null,
          settled_at: null,
          payload: {},
          received_at: new Date(),
          webhook_status: 'delivered',
          webhook_attempts: 1,
          recovered: false,
          wallet_name: 'Wallet A'
        }
      ]
    })
    const pool = { query } as unknown as pg.Pool
    const { events, error } = await recentEventsSafe(pool, 10)
    expect(error).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0].walletName).toBe('Wallet A')
  })
})
