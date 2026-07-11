import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  advanceCursor,
  bootstrapStore,
  computeEventKey,
  computeNwcRequestPayloadHash,
  countUndelivered,
  completeNwcRequest,
  getCursor,
  getNwcRequest,
  insertEventIfNew,
  markNwcRequestDispatched,
  markDelivery,
  pruneEvents,
  recentEvents,
  recentEventsSafe,
  recoverInterruptedNwcRequests,
  registerNwcRequest,
  resolveNwcRequestFromNotification,
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
    expect(sql).toContain('webhook_next_attempt_at = $5')
    expect(params).toEqual(['key-1', 'failed', 3, 'HTTP 500', null])
  })

  it('persists the next-attempt backoff timestamp when given', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    const next = new Date('2026-01-01T00:00:00Z')
    await markDelivery(pool, 'key-1', 'failed', 3, 'HTTP 500', next)
    const [, params] = query.mock.calls[0]
    expect(params).toEqual(['key-1', 'failed', 3, 'HTTP 500', next])
  })
})

describe('undeliveredEvents', () => {
  it('filters by staleness and the per-event retry gate, uncapped', async () => {
    const { pool, query } = poolWith({ rows: [] })
    await undeliveredEvents(pool, {
      olderThanMs: 120000,
      limit: 50
    })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("webhook_status <> 'delivered'")
    expect(sql).toContain('webhook_next_attempt_at IS NULL')
    // No attempt cap — a payment webhook retries until it lands.
    expect(sql).not.toContain('webhook_attempts <')
    expect(params).toEqual([120000, 50])
  })
})

describe('countUndelivered', () => {
  it('returns the backlog count and oldest received_at', async () => {
    const oldest = new Date('2026-01-01T00:00:00Z')
    const { pool, query } = poolWith({ rows: [{ count: 4, oldest }] })
    await expect(countUndelivered(pool)).resolves.toEqual({
      count: 4,
      oldestReceivedAt: oldest
    })
    const [sql] = query.mock.calls[0]
    expect(sql).toContain("webhook_status <> 'delivered'")
  })

  it('reports an empty backlog as zero / null', async () => {
    const { pool } = poolWith({ rows: [{ count: 0, oldest: null }] })
    await expect(countUndelivered(pool)).resolves.toEqual({
      count: 0,
      oldestReceivedAt: null
    })
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
  it('creates cursors and the idempotent NWC request journal', async () => {
    const { pool, query } = poolWith({ rowCount: 0 })
    await bootstrapStore(pool)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS listener.wallet_cursors')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS listener.nwc_requests')
    expect(sql).toContain('nwc_requests_unresolved_idx')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS recovered')
  })
})

describe('NWC request journal', () => {
  const request = {
    requestId: 'a'.repeat(64),
    walletId: 'wallet-1',
    invoice: 'lnbc1invoice',
    paymentHash: 'b'.repeat(64),
    payloadHash: computeNwcRequestPayloadHash(
      'wallet-1',
      'lnbc1invoice',
      'b'.repeat(64)
    )
  }
  const row = {
    request_id: request.requestId,
    wallet_id: request.walletId,
    invoice: request.invoice,
    payment_hash: request.paymentHash,
    payload_hash: request.payloadHash,
    state: 'pending' as const,
    dispatched_at: null,
    preimage: null,
    fees_paid_msats: null,
    error_code: null,
    error_message: null,
    wallet_error_code: null,
    created_at: new Date('2026-07-01T00:00:00Z'),
    updated_at: new Date('2026-07-01T00:00:00Z'),
    completed_at: null
  }

  it('atomically claims a request id before dispatch', async () => {
    const { pool, query } = poolWith({ rows: [row], rowCount: 1 })
    await expect(registerNwcRequest(pool, request)).resolves.toMatchObject({
      created: true,
      request: { requestId: request.requestId, state: 'pending' }
    })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (request_id) DO NOTHING')
    expect(params).toEqual([
      request.requestId,
      request.walletId,
      request.invoice,
      request.paymentHash,
      request.payloadHash,
      false
    ])
  })

  it('loads the durable owner when the request id already exists', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
    const pool = { query } as unknown as pg.Pool
    await expect(registerNwcRequest(pool, request)).resolves.toMatchObject({
      created: false,
      request: { payloadHash: request.payloadHash }
    })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('persists the dispatch boundary and terminal result separately', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await markNwcRequestDispatched(pool, request.requestId)
    expect(query.mock.calls[0][0]).toContain(
      'dispatched_at = COALESCE(dispatched_at, now())'
    )

    await completeNwcRequest(pool, request.requestId, {
      state: 'succeeded',
      preimage: 'c'.repeat(64),
      feesPaidMsats: 250
    })
    const [sql, params] = query.mock.calls[1]
    expect(sql).toContain("WHEN $2 IN ('succeeded', 'rejected', 'not_started')")
    expect(params).toEqual([
      request.requestId,
      'succeeded',
      'c'.repeat(64),
      250,
      null,
      null,
      null
    ])
  })

  it('classifies interrupted rows without ever republishing them', async () => {
    const { pool, query } = poolWith({ rowCount: 2 })
    await expect(recoverInterruptedNwcRequests(pool)).resolves.toBe(2)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain(
      "CASE WHEN dispatched_at IS NULL THEN 'not_started' ELSE 'unknown' END"
    )
    expect(sql).toContain("WHERE state = 'pending'")
  })

  it('resolves pending/unknown rows from a verified notification', async () => {
    const { pool, query } = poolWith({ rowCount: 1 })
    await expect(
      resolveNwcRequestFromNotification(pool, {
        walletId: request.walletId,
        paymentHash: request.paymentHash,
        preimage: 'c'.repeat(64),
        feesPaidMsats: 100
      })
    ).resolves.toBe(1)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain("state IN ('pending', 'unknown')")
  })

  it('returns null when a request id is absent', async () => {
    const { pool } = poolWith({ rows: [] })
    await expect(getNwcRequest(pool, request.requestId)).resolves.toBeNull()
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
    // Detail columns surfaced for the dashboard event modal.
    expect(sql).toContain('webhook_last_error')
    expect(sql).toContain('webhook_next_attempt_at')
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
