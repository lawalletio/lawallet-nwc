import { createHash } from 'node:crypto'
import type pg from 'pg'

/**
 * Service-owned persistence: a `listener` schema in the shared Postgres,
 * bootstrapped here with idempotent DDL. Never managed by apps/web's Prisma
 * migrations — web has zero knowledge of these tables.
 *
 * One table powers dedup (PK), the dashboard recent-events feed, per-wallet
 * lastEventAt, and webhook delivery tracking.
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

    CREATE INDEX IF NOT EXISTS processed_events_received_at_idx
      ON listener.processed_events (received_at DESC);
    CREATE INDEX IF NOT EXISTS processed_events_wallet_idx
      ON listener.processed_events (wallet_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS processed_events_webhook_status_idx
      ON listener.processed_events (webhook_status)
      WHERE webhook_status <> 'delivered';
  `)
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
}

export interface StoredEvent extends NewEvent {
  receivedAt: Date
  webhookStatus: 'pending' | 'delivered' | 'failed'
  webhookAttempts: number
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
       (event_key, wallet_id, notification_type, payment_hash, amount_msats, settled_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      event.eventKey,
      event.walletId,
      event.notificationType,
      event.paymentHash,
      event.amountMsats,
      event.settledAt,
      JSON.stringify(event.payload ?? {})
    ]
  )
  return (result.rowCount ?? 0) > 0
}

export async function markDelivery(
  pool: pg.Pool,
  eventKey: string,
  status: 'delivered' | 'failed',
  attempts: number,
  lastError?: string
): Promise<void> {
  await pool.query(
    `UPDATE listener.processed_events
        SET webhook_status = $2,
            webhook_attempts = $3,
            webhook_last_error = $4,
            delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END
      WHERE event_key = $1`,
    [eventKey, status, attempts, lastError ?? null]
  )
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
    webhookAttempts: row.webhook_attempts
  }
}

const EVENT_COLUMNS = `event_key, wallet_id, notification_type, payment_hash,
  amount_msats, settled_at, payload, received_at, webhook_status, webhook_attempts`

export async function recentEvents(
  pool: pg.Pool,
  limit = 50
): Promise<StoredEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${EVENT_COLUMNS}
       FROM listener.processed_events
      ORDER BY received_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows.map(toStored)
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
  opts: { maxAttempts: number; olderThanMs: number; limit: number }
): Promise<StoredEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${EVENT_COLUMNS}
       FROM listener.processed_events
      WHERE webhook_status <> 'delivered'
        AND webhook_attempts < $1
        AND received_at < now() - ($2::bigint * interval '1 millisecond')
      ORDER BY received_at ASC
      LIMIT $3`,
    [opts.maxAttempts, opts.olderThanMs, opts.limit]
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
