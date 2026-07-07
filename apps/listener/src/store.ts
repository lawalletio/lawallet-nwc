import { createHash } from 'node:crypto'
import type pg from 'pg'

/**
 * Service-owned persistence: a `listener` schema in the shared Postgres,
 * bootstrapped here with idempotent DDL. Never managed by apps/web's Prisma
 * migrations — web has zero knowledge of these tables.
 *
 * `processed_events` powers dedup (PK), the dashboard recent-events feed and
 * webhook delivery tracking; `wallet_cursors` persists the last-seen
 * timestamp per wallet that anchors missed-event catch-up after downtime.
 */
export async function bootstrapStore(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS listener;

    CREATE TABLE IF NOT EXISTS listener.processed_events (
      event_key          text PRIMARY KEY,
      wallet_id          text NOT NULL,
      notification_type  text NOT NULL,
      payment_hash       text,
      amount_msats       bigint,
      settled_at         timestamptz,
      payload            jsonb NOT NULL,
      received_at        timestamptz NOT NULL DEFAULT now(),
      webhook_status     text NOT NULL DEFAULT 'pending',
      webhook_attempts   integer NOT NULL DEFAULT 0,
      webhook_last_error text,
      delivered_at       timestamptz
    );

    -- Added after the first release — idempotent upgrade for existing schemas.
    ALTER TABLE listener.processed_events
      ADD COLUMN IF NOT EXISTS recovered boolean NOT NULL DEFAULT false;

    -- Per-event retry gate: a failed delivery defers its next attempt to this
    -- timestamp (exponential backoff). NULL = eligible immediately. Lets the
    -- sweep back off a long-unreachable web app WITHOUT ever giving up — there
    -- is no attempt cap, so a payment webhook is never permanently dropped.
    ALTER TABLE listener.processed_events
      ADD COLUMN IF NOT EXISTS webhook_next_attempt_at timestamptz;

    CREATE TABLE IF NOT EXISTS listener.wallet_cursors (
      wallet_id    text PRIMARY KEY,
      last_seen_at timestamptz NOT NULL,
      updated_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS processed_events_received_at_idx
      ON listener.processed_events (received_at DESC);
    CREATE INDEX IF NOT EXISTS processed_events_wallet_idx
      ON listener.processed_events (wallet_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS processed_events_webhook_status_idx
      ON listener.processed_events (webhook_status)
      WHERE webhook_status <> 'delivered';
    CREATE INDEX IF NOT EXISTS processed_events_retry_idx
      ON listener.processed_events (webhook_next_attempt_at)
      WHERE webhook_status <> 'delivered';
  `)
}

// ── Catch-up cursors ────────────────────────────────────────────────────────

/** Last-seen timestamp for a wallet, or null when never tracked. */
export async function getCursor(
  pool: pg.Pool,
  walletId: string
): Promise<Date | null> {
  const { rows } = await pool.query<{ last_seen_at: Date }>(
    `SELECT last_seen_at FROM listener.wallet_cursors WHERE wallet_id = $1`,
    [walletId]
  )
  return rows[0]?.last_seen_at ?? null
}

/**
 * First sighting of a wallet: seed the cursor at `at` WITHOUT backfilling —
 * recovery covers downtime, never imports pre-existing wallet history.
 */
export async function seedCursorIfMissing(
  pool: pg.Pool,
  walletId: string,
  at: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO listener.wallet_cursors (wallet_id, last_seen_at)
     VALUES ($1, $2)
     ON CONFLICT (wallet_id) DO NOTHING`,
    [walletId, at]
  )
}

/** Moves the cursor forward (never backward — GREATEST guards races). */
export async function advanceCursor(
  pool: pg.Pool,
  walletId: string,
  at: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO listener.wallet_cursors (wallet_id, last_seen_at, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (wallet_id) DO UPDATE
       SET last_seen_at = GREATEST(listener.wallet_cursors.last_seen_at, EXCLUDED.last_seen_at),
           updated_at = now()`,
    [walletId, at]
  )
}

/**
 * Dedup/idempotency key. @getalby/sdk's notification callback never exposes
 * the raw Nostr event id, so the key is derived — which also makes it stable
 * across relays replaying the same notification as different Nostr events.
 */
export function computeEventKey(
  walletId: string,
  notificationType: string,
  paymentHash: string
): string {
  return createHash('sha256')
    .update(`${walletId}|${notificationType}|${paymentHash}`)
    .digest('hex')
}

export interface NewEvent {
  eventKey: string
  walletId: string
  notificationType: string
  paymentHash: string | null
  amountMsats: number | null
  settledAt: Date | null
  payload: unknown
  /** True when synthesized by downtime catch-up rather than the live stream. */
  recovered: boolean
}

export interface StoredEvent extends NewEvent {
  receivedAt: Date
  webhookStatus: 'pending' | 'delivered' | 'failed'
  webhookAttempts: number
  /** RemoteWallet.name joined for the dashboard feed (null if wallet gone). */
  walletName?: string | null
}

/**
 * Atomic dedup: `false` means another delivery already owns this event.
 */
export async function insertEventIfNew(
  pool: pg.Pool,
  event: NewEvent
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO listener.processed_events
       (event_key, wallet_id, notification_type, payment_hash, amount_msats, settled_at, payload, recovered)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      event.eventKey,
      event.walletId,
      event.notificationType,
      event.paymentHash,
      event.amountMsats,
      event.settledAt,
      JSON.stringify(event.payload ?? {}),
      event.recovered
    ]
  )
  return (result.rowCount ?? 0) > 0
}

export async function markDelivery(
  pool: pg.Pool,
  eventKey: string,
  status: 'delivered' | 'failed',
  attempts: number,
  lastError?: string,
  /** When to next attempt a failed delivery (null clears the gate). */
  nextAttemptAt?: Date | null
): Promise<void> {
  await pool.query(
    `UPDATE listener.processed_events
        SET webhook_status = $2,
            webhook_attempts = $3,
            webhook_last_error = $4,
            delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
            webhook_next_attempt_at = $5
      WHERE event_key = $1`,
    [eventKey, status, attempts, lastError ?? null, nextAttemptAt ?? null]
  )
}

/** Undelivered-webhook backlog — count + age of the oldest — for observability. */
export async function countUndelivered(
  pool: pg.Pool
): Promise<{ count: number; oldestReceivedAt: Date | null }> {
  const { rows } = await pool.query<{ count: number; oldest: Date | null }>(
    `SELECT count(*)::int AS count, min(received_at) AS oldest
       FROM listener.processed_events
      WHERE webhook_status <> 'delivered'`
  )
  return {
    count: rows[0]?.count ?? 0,
    oldestReceivedAt: rows[0]?.oldest ?? null
  }
}

interface EventRow {
  event_key: string
  wallet_id: string
  notification_type: string
  payment_hash: string | null
  amount_msats: string | null
  settled_at: Date | null
  payload: unknown
  received_at: Date
  webhook_status: 'pending' | 'delivered' | 'failed'
  webhook_attempts: number
  recovered: boolean
  wallet_name?: string | null
}

function toStored(row: EventRow): StoredEvent {
  return {
    eventKey: row.event_key,
    walletId: row.wallet_id,
    notificationType: row.notification_type,
    paymentHash: row.payment_hash,
    // pg returns bigint as string; msat magnitudes fit Number safely
    amountMsats: row.amount_msats === null ? null : Number(row.amount_msats),
    settledAt: row.settled_at,
    payload: row.payload,
    receivedAt: row.received_at,
    webhookStatus: row.webhook_status,
    webhookAttempts: row.webhook_attempts,
    recovered: row.recovered,
    walletName: row.wallet_name ?? null
  }
}

const EVENT_COLUMNS = `e.event_key, e.wallet_id, e.notification_type, e.payment_hash,
  e.amount_msats, e.settled_at, e.payload, e.received_at, e.webhook_status,
  e.webhook_attempts, e.recovered`

export async function recentEvents(
  pool: pg.Pool,
  limit = 50
): Promise<StoredEvent[]> {
  // LEFT JOIN so the feed shows the NWC connection's display name; events of
  // deleted wallets survive with wallet_name = null.
  try {
    const { rows } = await pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}, rw.name AS wallet_name
         FROM listener.processed_events e
         LEFT JOIN "RemoteWallet" rw ON rw.id = e.wallet_id
        ORDER BY e.received_at DESC
        LIMIT $1`,
      [limit]
    )
    return rows.map(toStored)
  } catch (err) {
    // 42P01: "RemoteWallet" doesn't exist yet (fresh install, web's
    // migrations still running) — serve the feed without display names.
    if ((err as { code?: string }).code !== '42P01') throw err
    const { rows } = await pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS}
         FROM listener.processed_events e
        ORDER BY e.received_at DESC
        LIMIT $1`,
      [limit]
    )
    return rows.map(toStored)
  }
}

/**
 * `recentEvents` that never rejects: a transient DB fault (connection reset,
 * pool exhaustion, admin shutdown) returns an empty feed instead of throwing.
 * The /status endpoint uses this so one bad query can't 500 the whole
 * endpoint — the relay/connection/counter view is in-memory and always valid.
 * Returns the error alongside so the caller can flag the feed as degraded.
 */
export async function recentEventsSafe(
  pool: pg.Pool,
  limit = 50
): Promise<{ events: StoredEvent[]; error: unknown }> {
  try {
    return { events: await recentEvents(pool, limit), error: null }
  } catch (err) {
    return { events: [], error: err }
  }
}

/** Warms the per-wallet lastEventAt cache at startup. */
export async function lastEventAtByWallet(
  pool: pg.Pool
): Promise<Map<string, Date>> {
  const { rows } = await pool.query<{ wallet_id: string; last_at: Date }>(
    `SELECT wallet_id, MAX(received_at) AS last_at
       FROM listener.processed_events
      GROUP BY wallet_id`
  )
  return new Map(rows.map(row => [row.wallet_id, row.last_at]))
}

/**
 * Rows the sweep should re-attempt: not yet delivered, under the attempt cap,
 * and not touched in the last `olderThanMs` (so the inline retry loop and the
 * sweep don't race on fresh events).
 */
export async function undeliveredEvents(
  pool: pg.Pool,
  opts: { olderThanMs: number; limit: number }
): Promise<StoredEvent[]> {
  // No attempt cap: an undelivered event is retried for as long as it takes
  // (the per-event `webhook_next_attempt_at` backoff paces it). A payment
  // webhook is never abandoned just because the web app was down a while.
  const { rows } = await pool.query<EventRow>(
    `SELECT ${EVENT_COLUMNS}
       FROM listener.processed_events e
      WHERE e.webhook_status <> 'delivered'
        AND e.received_at < now() - ($1::bigint * interval '1 millisecond')
        AND (e.webhook_next_attempt_at IS NULL OR e.webhook_next_attempt_at <= now())
      ORDER BY e.received_at ASC
      LIMIT $2`,
    [opts.olderThanMs, opts.limit]
  )
  return rows.map(toStored)
}

export async function pruneEvents(
  pool: pg.Pool,
  retentionDays: number
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM listener.processed_events
      WHERE received_at < now() - ($1::int * interval '1 day')`,
    [retentionDays]
  )
  return result.rowCount ?? 0
}
