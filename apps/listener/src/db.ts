import pg from 'pg'
import type { Logger } from 'pino'
import {
  REMOTE_WALLET_CHANGED_CHANNEL,
  remoteWalletChangedSchema
} from '@lawallet-nwc/shared'
import type { ListenerEnv } from './env'

/** An ACTIVE NWC RemoteWallet row the pool should hold a connection for. */
export interface DesiredWallet {
  id: string
  name: string | null
  userId: string | null
  connectionString: string
}

export function createPgPool(env: ListenerEnv): pg.Pool {
  return new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 })
}

/** Blocks startup until Postgres answers (compose may start us first). */
export async function waitForDb(pool: pg.Pool, log: Logger): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      if (attempt === 30) throw err
      log.info({ attempt }, 'db.waiting')
      await sleep(1000)
    }
  }
}

export function isValidConnectionString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('nostr+walletconnect://') ||
      value.startsWith('nostrwalletconnect://'))
  )
}

interface WalletRow {
  id: string
  name: string | null
  userId: string | null
  connectionString: string | null
}

function toDesired(row: WalletRow, log: Logger): DesiredWallet | null {
  if (!isValidConnectionString(row.connectionString)) {
    // One bad row must never take down the pool — skip it loudly.
    log.warn({ walletId: row.id }, 'wallet.invalid_connection_string')
    return null
  }
  return {
    id: row.id,
    name: row.name,
    userId: row.userId,
    connectionString: row.connectionString
  }
}

export async function loadActiveNwcWallets(
  pool: pg.Pool,
  log: Logger
): Promise<DesiredWallet[]> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, name, "userId", config->>'connectionString' AS "connectionString"
       FROM "RemoteWallet"
      WHERE type = 'NWC' AND status = 'ACTIVE'`
  )
  return rows
    .map(row => toDesired(row, log))
    .filter((w): w is DesiredWallet => w !== null)
}

/**
 * Loads a single wallet for targeted reconciles. Returns null when the row is
 * gone, not NWC, not ACTIVE, or has a malformed connection string — all of
 * which mean "remove from the pool".
 */
export async function loadActiveWalletById(
  pool: pg.Pool,
  id: string,
  log: Logger
): Promise<DesiredWallet | null> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, name, "userId", config->>'connectionString' AS "connectionString"
       FROM "RemoteWallet"
      WHERE id = $1 AND type = 'NWC' AND status = 'ACTIVE'`,
    [id]
  )
  if (rows.length === 0) return null
  return toDesired(rows[0], log)
}

export interface WalletChangeListener {
  stop(): Promise<void>
}

/**
 * Dedicated LISTEN connection (never a pool client — those get recycled).
 * Reconnects with capped backoff; every (re)connect triggers a full
 * reconcile via `onChange(null)` to cover NOTIFYs missed while down.
 */
export function startWalletChangeListener(opts: {
  env: ListenerEnv
  log: Logger
  onChange: (payload: { id: string; op: string } | null) => void
}): WalletChangeListener {
  const { env, log, onChange } = opts
  let client: pg.Client | null = null
  let stopped = false
  let retryDelay = 1000
  let retryTimer: NodeJS.Timeout | null = null

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return
    const delay = retryDelay
    retryDelay = Math.min(retryDelay * 2, 30000)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void connect()
    }, delay)
    retryTimer.unref()
  }

  const connect = async () => {
    if (stopped) return
    client = new pg.Client({ connectionString: env.DATABASE_URL })

    client.on('notification', msg => {
      if (msg.channel !== REMOTE_WALLET_CHANGED_CHANNEL) return
      try {
        const parsed = remoteWalletChangedSchema.parse(
          JSON.parse(msg.payload ?? '')
        )
        onChange(parsed)
      } catch {
        // Unparseable payload (contract drift) — fall back to full reconcile.
        log.warn({ payload: msg.payload }, 'listen.unparseable_payload')
        onChange(null)
      }
    })

    client.on('error', err => {
      log.warn({ err }, 'listen.connection_error')
      teardown()
      scheduleReconnect()
    })

    try {
      await client.connect()
      await client.query(`LISTEN ${REMOTE_WALLET_CHANGED_CHANNEL}`)
      retryDelay = 1000
      log.info('listen.established')
      // Full reconcile after every (re)connect — the pipe may have been down.
      onChange(null)
    } catch (err) {
      log.warn({ err }, 'listen.connect_failed')
      teardown()
      scheduleReconnect()
    }
  }

  const teardown = () => {
    const c = client
    client = null
    if (!c) return
    c.removeAllListeners()
    void c.end().catch(() => {})
  }

  void connect()

  return {
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      const c = client
      client = null
      if (c) {
        c.removeAllListeners()
        await c.end().catch(() => {})
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
