import pg from 'pg'
import type { Logger } from 'pino'
import {
  REMOTE_WALLET_CHANGED_CHANNEL,
  remoteWalletChangedSchema
} from '@lawallet-nwc/shared'
import type { ListenerEnv } from './env'
import { decryptProxyNwcUri } from './proxy-vault'
import { decryptRemoteWalletNwcUri } from './remote-wallet-vault'

/** An ACTIVE NWC RemoteWallet row the pool should hold a connection for. */
export interface DesiredWallet {
  id: string
  name: string | null
  userId: string | null
  connectionString: string
}

const hexKey = /^[0-9a-f]{64}$/i
const bech32NostrKey = /^(?:npub|nsec)1[023456789acdefghjklmnpqrstuvwxyz]{58}$/i

export function createPgPool(env: ListenerEnv, log: Logger): pg.Pool {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 })
  // node-postgres emits 'error' on the Pool when an IDLE backend connection
  // drops (server restart, TCP reset, idle timeout). With no listener, that
  // 'error' event throws → uncaughtException → the whole daemon exits. Log and
  // swallow: pg discards the broken client and dials a fresh one on the next
  // checkout, so a DB blip degrades a query, never kills the process.
  pool.on('error', err => {
    log.warn({ err }, 'pg.idle_client_error')
  })
  return pool
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

/**
 * Blocks startup until web's `prisma migrate deploy` has created the
 * "RemoteWallet" table. On a fresh install both containers start together and
 * the listener would otherwise crash-loop on 42P01 until the migrations land.
 */
export async function waitForSchema(pool: pg.Pool, log: Logger): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt++) {
    const { rows } = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('"RemoteWallet"') AS reg`
    )
    if (rows[0]?.reg) return
    if (attempt === 60) {
      throw new Error(
        'The "RemoteWallet" table never appeared — did web\'s prisma migrate deploy run?'
      )
    }
    log.info({ attempt }, 'db.waiting_for_web_migrations')
    await sleep(2000)
  }
}

export function isValidConnectionString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    if (!/^(?:nostr\+walletconnect|nostrwalletconnect):\/\//i.test(value)) {
      return false
    }
    const normalized = value.replace(
      /^(?:nostr\+walletconnect|nostrwalletconnect):\/\//i,
      'https://'
    )
    const url = new URL(normalized)
    const walletPubkey = url.hostname
    const secret = url.searchParams.get('secret') ?? ''
    const relays = url.searchParams.getAll('relay')
    if (
      !(hexKey.test(walletPubkey) || bech32NostrKey.test(walletPubkey)) ||
      !(hexKey.test(secret) || bech32NostrKey.test(secret)) ||
      relays.length === 0
    ) {
      return false
    }
    return relays.every(relay => {
      const relayUrl = new URL(relay)
      return (
        (relayUrl.protocol === 'wss:' || relayUrl.protocol === 'ws:') &&
        relayUrl.hostname.length > 0
      )
    })
  } catch {
    return false
  }
}

interface WalletRow {
  id: string
  name: string | null
  userId: string | null
  connectionString: string | null
}

function toDesired(
  row: WalletRow,
  log: Logger,
  env?: ListenerEnv
): DesiredWallet | null {
  let connectionString: string | null = null
  try {
    connectionString =
      typeof row.connectionString === 'string'
        ? decryptRemoteWalletNwcUri(row.connectionString, row.id, env)
        : null
  } catch (err) {
    log.error({ err, walletId: row.id }, 'wallet.decrypt_failed')
    return null
  }
  if (!isValidConnectionString(connectionString)) {
    // One bad row must never take down the pool — skip it loudly.
    log.warn({ walletId: row.id }, 'wallet.invalid_connection_string')
    return null
  }
  return {
    id: row.id,
    name: row.name,
    userId: row.userId,
    connectionString
  }
}

export async function loadActiveNwcWallets(
  pool: pg.Pool,
  log: Logger,
  env?: ListenerEnv
): Promise<DesiredWallet[]> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, name, "userId", config->>'connectionString' AS "connectionString"
       FROM "RemoteWallet"
      WHERE type = 'NWC' AND status = 'ACTIVE'`
  )
  const wallets = rows
    .map(row => toDesired(row, log, env))
    .filter((w): w is DesiredWallet => w !== null)

  if (env?.NWC_VAULT_SECRET) {
    const proxy = await loadProxyWallet(pool, log, env)
    if (proxy) wallets.push(proxy)
  }
  return wallets
}

/**
 * Loads a single wallet for targeted reconciles. Returns null when the row is
 * gone, not NWC, not ACTIVE, or has a malformed connection string — all of
 * which mean "remove from the pool".
 */
export async function loadActiveWalletById(
  pool: pg.Pool,
  id: string,
  log: Logger,
  env?: ListenerEnv
): Promise<DesiredWallet | null> {
  const { rows } = await pool.query<WalletRow>(
    `SELECT id, name, "userId", config->>'connectionString' AS "connectionString"
       FROM "RemoteWallet"
      WHERE id = $1 AND type = 'NWC' AND status = 'ACTIVE'`,
    [id]
  )
  if (rows.length === 0) {
    return env?.NWC_VAULT_SECRET ? loadProxyWallet(pool, log, env, id) : null
  }
  return toDesired(rows[0], log, env)
}

interface ProxyWalletRow {
  id: string
  walletId: string
  nwcCiphertext: Buffer | null
}

async function loadProxyWallet(
  pool: pg.Pool,
  log: Logger,
  env: ListenerEnv,
  walletId?: string
): Promise<DesiredWallet | null> {
  let rows: ProxyWalletRow[]
  try {
    ;({ rows } = await pool.query<ProxyWalletRow>(
      `SELECT "id", "walletId", "nwcCiphertext"
       FROM "ProxyServiceConfig"
      WHERE "nwcCiphertext" IS NOT NULL
        AND (
          "enabled" = true
          OR EXISTS (
            SELECT 1
              FROM "ProxyPayment"
             WHERE "status" NOT IN (
               'COMPLETED'::"ProxyPaymentStatus",
               'EXPIRED'::"ProxyPaymentStatus"
             )
          )
        )
        ${walletId ? 'AND "walletId" = $1' : ''}
        LIMIT 1`,
      walletId ? [walletId] : []
    ))
  } catch (err) {
    // During a rolling deployment the listener can observe the old schema
    // briefly before web's Prisma migration creates this optional table.
    // Existing RemoteWallet monitoring must remain available in that window.
    if ((err as { code?: string }).code === '42P01') {
      log.info('proxy_wallet.schema_not_ready')
      return null
    }
    throw err
  }
  const row = rows[0]
  if (!row?.nwcCiphertext) return null
  try {
    const connectionString = decryptProxyNwcUri(row.nwcCiphertext, row.id, env)
    if (!isValidConnectionString(connectionString)) {
      log.warn({ walletId: row.walletId }, 'proxy_wallet.invalid_connection')
      return null
    }
    return {
      id: row.walletId,
      name: 'LaWallet LUD-16 Proxy',
      userId: null,
      connectionString
    }
  } catch (err) {
    log.error({ err, walletId: row.walletId }, 'proxy_wallet.decrypt_failed')
    return null
  }
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
