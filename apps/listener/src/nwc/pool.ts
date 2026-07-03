import {
  NWCClient,
  Nip47Error,
  Nip47TimeoutError,
  Nip47WalletError
} from '@getalby/sdk'
import type { Nip47Notification, Nip47NotificationType } from '@getalby/sdk'
import type { Logger } from 'pino'
import type {
  ListenerConnection,
  NwcProxyErrorCode,
  NwcProxyMethod
} from '@lawallet-nwc/shared'
import type { DesiredWallet } from '../db'
import { diffWallets, type CurrentWallet } from './reconcile'

const SUBSCRIBED_TYPES: Nip47NotificationType[] = [
  'payment_received',
  'payment_sent'
]

/** Transport/wallet failure surfaced by {@link NwcPool.request}. */
export class NwcPoolError extends Error {
  code: NwcProxyErrorCode
  walletErrorCode?: string

  constructor(
    code: NwcProxyErrorCode,
    message: string,
    walletErrorCode?: string
  ) {
    super(message)
    this.name = 'NwcPoolError'
    this.code = code
    this.walletErrorCode = walletErrorCode
  }
}

type WalletState = 'connecting' | 'subscribed' | 'error' | 'closed'

interface WalletConnection {
  wallet: DesiredWallet
  client: NWCClient | null
  unsub: (() => void) | null
  state: WalletState
  lastEventAt: Date | null
  lastErrorAt: Date | null
  lastError: string | null
  retryTimer: NodeJS.Timeout | null
  retryAttempt: number
  errorNotified: boolean
  /** Bumped on remove/rotate so stale async connects abort themselves. */
  generation: number
}

// The SDK methods take typed NIP-47 request objects; proxied params arrive as
// a plain record built by web's driver, so each entry casts at the boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */
const METHOD_MAP: Record<
  NwcProxyMethod,
  (client: NWCClient, params: Record<string, unknown>) => Promise<unknown>
> = {
  get_info: client => client.getInfo(),
  get_balance: client => client.getBalance(),
  pay_invoice: (client, params) => client.payInvoice(params as any),
  make_invoice: (client, params) => client.makeInvoice(params as any),
  lookup_invoice: (client, params) => client.lookupInvoice(params as any),
  list_transactions: (client, params) => client.listTransactions(params as any)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface NwcPoolDeps {
  log: Logger
  onNotification: (
    wallet: DesiredWallet,
    notification: Nip47Notification
  ) => void
  /** Fired once per error streak (reset on successful subscribe). */
  onWalletError?: (wallet: DesiredWallet, error: Error) => void
}

/**
 * Holds one live NWCClient per ACTIVE NWC RemoteWallet for the process
 * lifetime. The SDK owns resubscribes after the first successful subscribe;
 * this pool owns initial-connect backoff, rotation, and state tracking.
 */
export class NwcPool {
  private readonly deps: NwcPoolDeps
  private readonly connections = new Map<string, WalletConnection>()
  private readonly byConnectionString = new Map<string, string>()
  /** Serializes reconciles so two never interleave. */
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(deps: NwcPoolDeps) {
    this.deps = deps
  }

  /** Seeds per-wallet lastEventAt from the persistent store at startup. */
  seedLastEventAt(byWallet: Map<string, Date>): void {
    for (const [walletId, at] of byWallet) {
      const conn = this.connections.get(walletId)
      if (conn && !conn.lastEventAt) conn.lastEventAt = at
    }
  }

  reconcile(desired: DesiredWallet[]): Promise<void> {
    return this.enqueue(() => this.applyFull(desired))
  }

  reconcileOne(walletId: string, row: DesiredWallet | null): Promise<void> {
    return this.enqueue(async () => this.applyOne(walletId, row))
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private async applyFull(desired: DesiredWallet[]): Promise<void> {
    if (this.closed) return
    const current: CurrentWallet[] = [...this.connections.values()].map(c => ({
      id: c.wallet.id,
      connectionString: c.wallet.connectionString
    }))
    const diff = diffWallets(current, desired)

    for (const id of diff.remove) this.removeWallet(id)
    for (const wallet of diff.update) {
      this.removeWallet(wallet.id)
      this.addWallet(wallet)
    }
    for (const wallet of diff.add) this.addWallet(wallet)

    // Refresh display metadata in place — no reconnect needed.
    for (const wallet of desired) {
      const conn = this.connections.get(wallet.id)
      if (conn) conn.wallet = { ...wallet }
    }
  }

  private applyOne(walletId: string, row: DesiredWallet | null): void {
    if (this.closed) return
    const existing = this.connections.get(walletId)

    if (!row) {
      if (existing) this.removeWallet(walletId)
      return
    }
    if (!existing) {
      this.addWallet(row)
      return
    }
    if (existing.wallet.connectionString !== row.connectionString) {
      this.removeWallet(walletId)
      this.addWallet(row)
      return
    }
    existing.wallet = { ...row }
  }

  private addWallet(wallet: DesiredWallet): void {
    const conn: WalletConnection = {
      wallet: { ...wallet },
      client: null,
      unsub: null,
      state: 'connecting',
      lastEventAt: null,
      lastErrorAt: null,
      lastError: null,
      retryTimer: null,
      retryAttempt: 0,
      errorNotified: false,
      generation: 0
    }
    this.connections.set(wallet.id, conn)
    this.byConnectionString.set(wallet.connectionString, wallet.id)
    void this.connect(conn)
  }

  private removeWallet(walletId: string): void {
    const conn = this.connections.get(walletId)
    if (!conn) return
    conn.generation++
    conn.state = 'closed'
    if (conn.retryTimer) clearTimeout(conn.retryTimer)
    this.teardownClient(conn)
    this.byConnectionString.delete(conn.wallet.connectionString)
    this.connections.delete(walletId)
    this.deps.log.info({ walletId }, 'pool.wallet_removed')
  }

  private teardownClient(conn: WalletConnection): void {
    try {
      conn.unsub?.()
    } catch {
      // best-effort
    }
    try {
      conn.client?.close()
    } catch {
      // best-effort
    }
    conn.unsub = null
    conn.client = null
  }

  private async connect(conn: WalletConnection): Promise<void> {
    const generation = conn.generation
    const { log } = this.deps
    conn.state = 'connecting'

    try {
      const client = new NWCClient({
        nostrWalletConnectUrl: conn.wallet.connectionString
      })
      const unsub = await client.subscribeNotifications(notification => {
        conn.lastEventAt = new Date()
        this.deps.onNotification(conn.wallet, notification)
      }, SUBSCRIBED_TYPES)

      if (conn.generation !== generation) {
        // Removed or rotated while we were connecting — undo quietly.
        try {
          unsub()
        } catch {
          // best-effort
        }
        client.close()
        return
      }

      conn.client = client
      conn.unsub = unsub
      conn.state = 'subscribed'
      conn.retryAttempt = 0
      conn.errorNotified = false
      log.info(
        { walletId: conn.wallet.id, relays: client.relayUrls },
        'pool.wallet_subscribed'
      )
    } catch (err) {
      if (conn.generation !== generation) return
      const error = err instanceof Error ? err : new Error(String(err))
      conn.state = 'error'
      conn.lastErrorAt = new Date()
      conn.lastError = error.message
      this.teardownClient(conn)
      log.warn(
        { err: error, walletId: conn.wallet.id, attempt: conn.retryAttempt },
        'pool.wallet_connect_failed'
      )
      if (!conn.errorNotified) {
        conn.errorNotified = true
        this.deps.onWalletError?.(conn.wallet, error)
      }
      this.scheduleRetry(conn)
    }
  }

  private scheduleRetry(conn: WalletConnection): void {
    if (this.closed || conn.state === 'closed') return
    const base = Math.min(1000 * 2 ** conn.retryAttempt, 60000)
    const jitter = base * 0.25 * (Math.random() * 2 - 1)
    conn.retryAttempt++
    conn.retryTimer = setTimeout(
      () => {
        conn.retryTimer = null
        void this.connect(conn)
      },
      Math.round(base + jitter)
    )
    conn.retryTimer.unref()
  }

  /**
   * Proxies an NWC request through the already-open client for this
   * connection string. Throws {@link NwcPoolError} — `wallet_not_found` /
   * `wallet_not_connected` / `timeout` / `relay_error` are transport-level
   * (caller may fall back to a direct connection); `wallet_error` is the
   * wallet's own NIP-47 rejection and must be treated as final.
   */
  async request(
    connectionString: string,
    method: NwcProxyMethod,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const walletId = this.byConnectionString.get(connectionString)
    const conn = walletId ? this.connections.get(walletId) : undefined
    if (!conn) {
      throw new NwcPoolError(
        'wallet_not_found',
        'No pooled connection for this wallet'
      )
    }
    if (conn.state !== 'subscribed' || !conn.client) {
      throw new NwcPoolError(
        'wallet_not_connected',
        `Wallet connection is ${conn.state}`
      )
    }

    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new NwcPoolError(
              'timeout',
              `NWC ${method} timed out after ${timeoutMs}ms`
            )
          ),
        timeoutMs
      )
    })

    try {
      return await Promise.race([
        METHOD_MAP[method](conn.client, params),
        timeout
      ])
    } catch (err) {
      if (err instanceof NwcPoolError) throw err
      conn.lastErrorAt = new Date()
      conn.lastError = err instanceof Error ? err.message : String(err)
      if (err instanceof Nip47WalletError) {
        throw new NwcPoolError('wallet_error', err.message, err.code)
      }
      if (err instanceof Nip47TimeoutError) {
        throw new NwcPoolError('timeout', err.message)
      }
      if (err instanceof Nip47Error) {
        throw new NwcPoolError('relay_error', err.message)
      }
      throw new NwcPoolError(
        'relay_error',
        err instanceof Error ? err.message : 'Unknown NWC transport error'
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  snapshot(): ListenerConnection[] {
    return [...this.connections.values()].map(conn => ({
      walletId: conn.wallet.id,
      walletName: conn.wallet.name,
      userId: conn.wallet.userId,
      state: conn.state,
      connected: conn.client?.connected ?? false,
      relayUrls: conn.client?.relayUrls ?? [],
      lastEventAt: conn.lastEventAt?.toISOString() ?? null,
      lastErrorAt: conn.lastErrorAt?.toISOString() ?? null,
      lastError: conn.lastError
    }))
  }

  relaySummary(): { url: string; connected: boolean; walletCount: number }[] {
    const relays = new Map<
      string,
      { connected: boolean; walletCount: number }
    >()
    for (const conn of this.connections.values()) {
      if (!conn.client) continue
      // listConnectionStatus() is empty until the pool has dialed at least
      // once — those relays report as not-connected, matching 'connecting'.
      const status = conn.client.pool.listConnectionStatus()
      for (const url of conn.client.relayUrls) {
        const entry = relays.get(url) ?? { connected: false, walletCount: 0 }
        entry.walletCount++
        entry.connected = entry.connected || (status.get(url) ?? false)
        relays.set(url, entry)
      }
    }
    return [...relays.entries()].map(([url, entry]) => ({ url, ...entry }))
  }

  async closeAll(): Promise<void> {
    this.closed = true
    for (const conn of this.connections.values()) {
      conn.generation++
      conn.state = 'closed'
      if (conn.retryTimer) clearTimeout(conn.retryTimer)
      this.teardownClient(conn)
    }
    this.connections.clear()
    this.byConnectionString.clear()
  }
}
