import { Client, type Notification } from 'pg'
import { getConfig } from '../config/index.js'
import { createChildLogger } from '../logger.js'
import type { ConnectionManager } from '../nostr/subscription-manager.js'

const log = createChildLogger({ module: 'db-change-listener' })

const CHANNEL = 'nwc_connection_change'
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000
const RECONNECT_MIN_MS = 3_000
const RECONNECT_MAX_MS = 30_000

type Payload = {
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  id: string
  enabled: boolean
}

/**
 * Listens on Postgres NOTIFY channel `nwc_connection_change` (emitted by the
 * trigger installed in migration 20260421180000_nwc_change_notify) and
 * dispatches ConnectionManager reconciliations. Runs a periodic full
 * reloadAll as a safety net against missed notifications.
 *
 * Uses a dedicated pg.Client rather than Prisma because the Prisma client
 * neither exposes LISTEN nor owns a long-lived connection of its own.
 */
export class NwcChangeListener {
  private client: Client | null = null
  private reconnectDelayMs = RECONNECT_MIN_MS
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(private connectionManager: ConnectionManager) {}

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
    this.reconcileTimer = setInterval(
      () => this.reconcileSafely('periodic'),
      RECONCILE_INTERVAL_MS
    )
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = null
    }
    const client = this.client
    this.client = null
    if (client) {
      try {
        await client.end()
      } catch (err) {
        log.warn({ err }, 'error closing pg listener')
      }
    }
  }

  private async connect(): Promise<void> {
    const { databaseUrl } = getConfig().storage
    const client = new Client({ connectionString: databaseUrl })

    client.on('notification', (msg: Notification) => {
      log.debug(
        { channel: msg.channel, processId: msg.processId, payload: msg.payload },
        'raw pg notification'
      )
      this.handleNotification(msg).catch(err =>
        log.error({ err }, 'notification handler threw')
      )
    })

    client.on('error', err => {
      log.warn({ err }, 'pg listener error — will reconnect')
      void this.scheduleReconnect()
    })

    client.on('end', () => {
      if (this.stopped) return
      log.warn('pg listener connection ended — will reconnect')
      void this.scheduleReconnect()
    })

    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    this.client = client
    this.reconnectDelayMs = RECONNECT_MIN_MS
    log.info({ channel: CHANNEL }, 'pg listener connected')
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) return
    const old = this.client
    this.client = null
    if (old) {
      try {
        await old.end()
      } catch {
        /* ignore — best effort */
      }
    }

    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS)
    log.info({ delayMs: delay }, 'scheduling pg listener reconnect')

    setTimeout(() => {
      if (this.stopped) return
      this.connect()
        .then(() => this.reconcileSafely('post-reconnect'))
        .catch(err => {
          log.warn({ err }, 'reconnect attempt failed')
          void this.scheduleReconnect()
        })
    }, delay)
  }

  private async handleNotification(msg: Notification): Promise<void> {
    if (msg.channel !== CHANNEL || !msg.payload) return

    let parsed: Payload
    try {
      parsed = JSON.parse(msg.payload) as Payload
    } catch (err) {
      log.warn({ err, payload: msg.payload }, 'malformed notification payload — skipping')
      return
    }

    log.info(
      { op: parsed.op, id: parsed.id, enabled: parsed.enabled },
      'nwc_connection_change received'
    )

    try {
      switch (parsed.op) {
        case 'INSERT':
          await this.connectionManager.open(parsed.id)
          return
        case 'UPDATE':
          await this.connectionManager.reload(parsed.id)
          return
        case 'DELETE':
          await this.connectionManager.close(parsed.id)
          return
        default:
          log.warn({ op: parsed.op }, 'unknown op — skipping')
      }
    } catch (err) {
      log.error({ err, op: parsed.op, id: parsed.id }, 'reconcile failed')
    }
  }

  private async reconcileSafely(source: 'periodic' | 'post-reconnect'): Promise<void> {
    try {
      await this.connectionManager.reloadAll()
      log.info({ source }, 'reconcile complete')
    } catch (err) {
      log.warn({ err, source }, 'reconcile failed')
    }
  }
}
