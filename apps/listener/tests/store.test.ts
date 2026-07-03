import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  computeEventKey,
  insertEventIfNew,
  markDelivery,
  pruneEvents,
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
  payload: { amount: 21000 }
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
