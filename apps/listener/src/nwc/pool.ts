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

type WalletState =
  | 'connecting'
  | 'negotiating'
  | 'ready'
  | 'disconnected'
  | 'error'
  | 'closed'

interface WalletConnection {
  wallet: DesiredWallet
  client: NWCClient | null
  unsub: (() => void) | null
  state: WalletState
  lastEventAt: Date | null
  lastErrorAt: Date | null
  lastError: string | null
  lastCatchupAt: Date | null
  /**
   * Last time the wallet demonstrably answered: a received notification, a
   * successful proxied request, a successful liveness probe, or the initial
   * subscribe. Anchors dead-wallet detection — a wallet silent past the
   * threshold WHILE its relays stay up is a destroyed LNCurl wallet.
   */
  lastResponsiveAt: Date | null
  retryTimer: NodeJS.Timeout | null
  retryAttempt: number
  errorNotified: boolean
  /** Relay-connectivity snapshot the reconnect watcher diffs against. */
  wasConnected: boolean
  /** Bumped on remove/rotate so stale async connects abort themselves. */
  generation: number
  /** Foreground card payments suppress maintenance probes/catch-up work. */
  foregroundPayments: number
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
  /** Fired after a wallet's live subscription is established (startup, add, rotation). */
  onSubscribed?: (wallet: DesiredWallet, client: NWCClient) => void
  /**
   * Fired when the 30s watcher sees a wallet's relay connectivity flip back
   * from disconnected to connected — the SDK resubscribed on its own, but
   * events published during the gap were missed (catch-up trigger).
   */
  onReconnected?: (wallet: DesiredWallet, client: NWCClient) => void
}

/** How often the reconnect watcher samples relay connectivity. */
const WATCHER_INTERVAL_MS = 30000
/** Avoid a startup relay storm while keeping enough parallel warm-ups. */
const MAX_CONCURRENT_NEGOTIATIONS = 8
const WARMUP_TIMEOUT_MS = 15000

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
  private watcherTimer: NodeJS.Timeout | null = null
  private readonly readyWaiters = new Map<
    string,
    Set<(ready: boolean) => void>
  >()
  private connectQueue: WalletConnection[] = []
  private activeConnects = 0

  constructor(deps: NwcPoolDeps) {
    this.deps = deps
    // State accuracy matters to the payment fast path even when missed-event
    // catch-up is disabled, so the relay watcher always runs. onReconnected
    // remains optional.
    this.watcherTimer = setInterval(
      () => this.checkReconnects(),
      WATCHER_INTERVAL_MS
    )
    this.watcherTimer.unref()
  }

  private checkReconnects(): void {
    for (const conn of this.connections.values()) {
      if (
        (conn.state !== 'ready' && conn.state !== 'disconnected') ||
        !conn.client
      ) {
        continue
      }
      const connected = isConnectedSafe(conn.client)
      if (!connected) {
        conn.state = 'disconnected'
      } else if (!conn.wasConnected || conn.state === 'disconnected') {
        conn.state = 'ready'
        this.resolveReadyWaiters(conn.wallet.id, true)
        this.deps.onReconnected?.(conn.wallet, conn.client)
      }
      conn.wasConnected = connected
    }
  }

  /** Records when a catch-up run completed, surfaced in /status snapshots. */
  noteCatchup(walletId: string, at: Date): void {
    const conn = this.connections.get(walletId)
    if (conn) conn.lastCatchupAt = at
  }

  /** Bump the liveness clock — called by the prober on a successful probe. */
  markResponsive(walletId: string): void {
    const conn = this.connections.get(walletId)
    if (conn) conn.lastResponsiveAt = new Date()
  }

  /**
   * Wallets that look dead: subscribed, relays currently CONNECTED (so this is
   * the wallet going silent, not a network outage), and no proof of life for
   * at least `thresholdMs`. The prober confirms with an active probe before
   * declaring death — this is only the candidate filter.
   */
  deadCandidates(thresholdMs: number): Array<{
    wallet: DesiredWallet
    client: NWCClient
    unresponsiveMs: number
  }> {
    const now = Date.now()
    const out: Array<{
      wallet: DesiredWallet
      client: NWCClient
      unresponsiveMs: number
    }> = []
    for (const conn of this.connections.values()) {
      if (
        conn.state !== 'ready' ||
        !conn.client ||
        conn.foregroundPayments > 0
      ) {
        continue
      }
      // Relays down → unreachable is a transport fault, NOT wallet death.
      if (!isConnectedSafe(conn.client)) continue
      if (!conn.lastResponsiveAt) continue
      const unresponsiveMs = now - conn.lastResponsiveAt.getTime()
      if (unresponsiveMs >= thresholdMs) {
        out.push({ wallet: conn.wallet, client: conn.client, unresponsiveMs })
      }
    }
    return out
  }

  /** True iff the wallet's relays are currently connected (guarded read). */
  relaysConnected(walletId: string): boolean {
    const conn = this.connections.get(walletId)
    return !!conn?.client && isConnectedSafe(conn.client)
  }

  /**
   * True iff the pool STILL holds this exact client for the wallet. The prober
   * captures a client, then awaits a probe — a rotation/removal can swap in a
   * fresh client meanwhile, and a timeout against the old (closed) client must
   * not be read as death of the new one.
   */
  holdsClient(walletId: string, client: NWCClient): boolean {
    return this.connections.get(walletId)?.client === client
  }

  /** Live subscriptions — the periodic catch-up sweep iterates these. */
  subscribedClients(): Array<{ wallet: DesiredWallet; client: NWCClient }> {
    const out: Array<{ wallet: DesiredWallet; client: NWCClient }> = []
    for (const conn of this.connections.values()) {
      if (
        conn.state === 'ready' &&
        conn.client &&
        conn.foregroundPayments === 0
      ) {
        out.push({ wallet: conn.wallet, client: conn.client })
      }
    }
    return out
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
      this.addWallet(row, true)
      return
    }
    if (existing.wallet.connectionString !== row.connectionString) {
      this.removeWallet(walletId)
      this.addWallet(row, true)
      return
    }
    existing.wallet = { ...row }
  }

  private addWallet(wallet: DesiredWallet, priority = false): void {
    const conn: WalletConnection = {
      wallet: { ...wallet },
      client: null,
      unsub: null,
      state: 'connecting',
      lastEventAt: null,
      lastErrorAt: null,
      lastError: null,
      lastCatchupAt: null,
      lastResponsiveAt: null,
      retryTimer: null,
      retryAttempt: 0,
      errorNotified: false,
      wasConnected: false,
      generation: 0,
      foregroundPayments: 0
    }
    this.connections.set(wallet.id, conn)
    this.byConnectionString.set(wallet.connectionString, wallet.id)
    this.enqueueConnect(conn, priority)
  }

  private enqueueConnect(conn: WalletConnection, priority: boolean): void {
    if (this.closed || this.connections.get(conn.wallet.id) !== conn) return
    if (priority) this.connectQueue.unshift(conn)
    else this.connectQueue.push(conn)
    this.drainConnectQueue()
  }

  private drainConnectQueue(): void {
    while (
      !this.closed &&
      this.activeConnects < MAX_CONCURRENT_NEGOTIATIONS &&
      this.connectQueue.length > 0
    ) {
      const conn = this.connectQueue.shift()!
      if (this.connections.get(conn.wallet.id) !== conn) continue
      this.activeConnects++
      void this.connect(conn).finally(() => {
        this.activeConnects--
        this.drainConnectQueue()
      })
    }
  }

  private removeWallet(walletId: string): void {
    const conn = this.connections.get(walletId)
    if (!conn) return
    conn.generation++
    conn.state = 'closed'
    this.resolveReadyWaiters(walletId, false)
    if (conn.retryTimer) clearTimeout(conn.retryTimer)
    this.teardownClient(conn)
    this.byConnectionString.delete(conn.wallet.connectionString)
    this.connections.delete(walletId)
    this.deps.log.info({ walletId }, 'pool.wallet_removed')
  }

  private teardownClient(conn: WalletConnection): void {
    // unsub()/close() are best-effort AND may return a promise (the SDK's
    // SimplePool close awaits socket teardown). Swallow both sync throws and
    // async rejections — a teardown hiccup on a dying wallet must never float
    // up as an unhandledRejection and crash the daemon.
    try {
      const r = conn.unsub?.() as unknown
      if (isThenable(r)) r.catch(() => {})
    } catch {
      // best-effort
    }
    try {
      const r = conn.client?.close() as unknown
      if (isThenable(r)) r.catch(() => {})
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
        // A synchronous throw here would escape into the SDK's relay event
        // dispatch (unhandled). Isolate it. A received notification is also
        // proof of life for dead-wallet detection.
        try {
          const now = new Date()
          conn.lastEventAt = now
          conn.lastResponsiveAt = now
          this.deps.onNotification(conn.wallet, notification)
        } catch (err) {
          this.deps.log.error(
            { err, walletId: conn.wallet.id },
            'pool.on_notification_threw'
          )
        }
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
      conn.state = 'negotiating'

      // subscribeNotifications starts the relay work but may resolve before
      // the NIP-47 request/response channel is actually usable. A get_info
      // round-trip proves relay connectivity, encryption and wallet response
      // handling before the low-latency payment endpoint advertises readiness.
      // A wallet-level rejection still proves the transport is operational.
      try {
        await withTimeout(
          client.getInfo(),
          WARMUP_TIMEOUT_MS,
          'NWC get_info warm-up timed out'
        )
      } catch (err) {
        if (!(err instanceof Nip47WalletError)) throw err
        log.debug(
          { walletId: conn.wallet.id, code: err.code },
          'pool.wallet_warmup_rejected'
        )
      }

      if (conn.generation !== generation) {
        this.teardownClient(conn)
        return
      }

      conn.state = 'ready'
      conn.retryAttempt = 0
      conn.errorNotified = false
      // Seed the liveness clock so a freshly (re)subscribed wallet isn't
      // instantly a dead-wallet candidate.
      conn.lastResponsiveAt = new Date()
      // Assume connected at subscribe time — the watcher corrects the flag on
      // its next sample and fires onReconnected on the false → true edge.
      conn.wasConnected = true
      log.info(
        { walletId: conn.wallet.id, relays: client.relayUrls },
        'pool.wallet_ready'
      )
      this.resolveReadyWaiters(conn.wallet.id, true)
      this.deps.onSubscribed?.(conn.wallet, client)
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
        this.enqueueConnect(conn, true)
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
    if (!walletId) {
      throw new NwcPoolError(
        'wallet_not_found',
        'No pooled connection for this wallet'
      )
    }
    return this.requestByWalletId(walletId, method, params, timeoutMs)
  }

  /** Legacy proxy request routed by wallet id after connection-string lookup. */
  async requestByWalletId(
    walletId: string,
    method: NwcProxyMethod,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const conn = this.requireReady(walletId)
    const client = conn.client as NWCClient

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
      const result = await Promise.race([
        METHOD_MAP[method](client, params),
        timeout
      ])
      // A wallet that answered a proxied call is demonstrably alive.
      conn.lastResponsiveAt = new Date()
      return result
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

  /** True when the wallet exists in the pool, regardless of readiness. */
  hasWallet(walletId: string): boolean {
    return this.connections.has(walletId)
  }

  /** True only after subscription + get_info negotiation completed. */
  isReady(walletId: string): boolean {
    const conn = this.connections.get(walletId)
    if (!conn?.client) return false
    const connected = isConnectedSafe(conn.client)
    if (!connected) {
      if (conn.state === 'ready') conn.state = 'disconnected'
      conn.wasConnected = false
      return false
    }
    // The SDK may reconnect between 30-second watcher samples. Promote only a
    // previously-negotiated disconnected client; never skip get_info while a
    // fresh connection is still in `negotiating`.
    if (conn.state === 'disconnected') {
      conn.state = 'ready'
      conn.wasConnected = true
      this.resolveReadyWaiters(walletId, true)
      this.deps.onReconnected?.(conn.wallet, conn.client)
    }
    return conn.state === 'ready'
  }

  /** Move a queued/error wallet ahead of background startup negotiations. */
  prioritizeWallet(walletId: string): void {
    const conn = this.connections.get(walletId)
    if (!conn || conn.state === 'ready' || conn.state === 'closed') return
    const queued = this.connectQueue.indexOf(conn)
    if (queued >= 0) {
      this.connectQueue.splice(queued, 1)
      this.connectQueue.unshift(conn)
      this.drainConnectQueue()
      return
    }
    if (conn.state === 'error' && conn.retryTimer) {
      clearTimeout(conn.retryTimer)
      conn.retryTimer = null
      this.enqueueConnect(conn, true)
    }
  }

  /** Waits briefly for an in-progress targeted reconcile/warm-up. */
  waitUntilReady(walletId: string, timeoutMs: number): Promise<boolean> {
    if (this.isReady(walletId)) return Promise.resolve(true)
    if (this.closed) return Promise.resolve(false)

    return new Promise(resolve => {
      const waiters = this.readyWaiters.get(walletId) ?? new Set()
      let settled = false
      const finish = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        waiters.delete(finish)
        if (waiters.size === 0) this.readyWaiters.delete(walletId)
        resolve(ready)
      }
      waiters.add(finish)
      this.readyWaiters.set(walletId, waiters)
      const timer = setTimeout(() => finish(this.isReady(walletId)), timeoutMs)
      timer.unref()
    })
  }

  /**
   * Starts one foreground payment on the already-warmed client. No outer
   * timeout is applied: callers may stop waiting, but the SDK operation keeps
   * running and can journal a late result.
   */
  async payInvoiceByWalletId(
    walletId: string,
    invoice: string
  ): Promise<unknown> {
    const conn = this.requireReady(walletId)
    const client = conn.client as NWCClient
    conn.foregroundPayments++
    try {
      const result = await client.payInvoice({ invoice })
      conn.lastResponsiveAt = new Date()
      return result
    } catch (err) {
      throw this.mapSdkError(conn, err)
    } finally {
      conn.foregroundPayments = Math.max(0, conn.foregroundPayments - 1)
    }
  }

  /** Read-only recovery for a payment whose dispatch outcome is ambiguous. */
  async lookupInvoiceByWalletId(
    walletId: string,
    paymentHash: string
  ): Promise<unknown> {
    const conn = this.requireReady(walletId)
    try {
      const result = await conn.client!.lookupInvoice({
        payment_hash: paymentHash
      })
      conn.lastResponsiveAt = new Date()
      return result
    } catch (err) {
      throw this.mapSdkError(conn, err)
    }
  }

  hasForegroundPayment(walletId: string): boolean {
    return (this.connections.get(walletId)?.foregroundPayments ?? 0) > 0
  }

  readinessSummary(): { total: number; ready: number; notReady: number } {
    const total = this.connections.size
    let ready = 0
    for (const conn of this.connections.values()) {
      if (this.isReady(conn.wallet.id)) ready++
    }
    return { total, ready, notReady: total - ready }
  }

  snapshot(): ListenerConnection[] {
    return [...this.connections.values()].map(conn => ({
      walletId: conn.wallet.id,
      walletName: conn.wallet.name,
      userId: conn.wallet.userId,
      state: conn.state,
      connected: conn.client ? isConnectedSafe(conn.client) : false,
      relayUrls: conn.client?.relayUrls ?? [],
      lastEventAt: conn.lastEventAt?.toISOString() ?? null,
      lastErrorAt: conn.lastErrorAt?.toISOString() ?? null,
      lastError: conn.lastError,
      lastCatchupAt: conn.lastCatchupAt?.toISOString() ?? null
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
      // Its keys are NORMALIZED by nostr-tools (bare domains gain a trailing
      // slash: wss://relay.x → wss://relay.x/), while relayUrls keeps the raw
      // URI from the connection string — normalize BOTH sides or every
      // bare-domain relay reads as disconnected forever.
      const status = new Map<string, boolean>()
      for (const [url, connected] of conn.client.pool.listConnectionStatus()) {
        status.set(normalizeRelayUrl(url), connected)
      }
      for (const rawUrl of conn.client.relayUrls) {
        const url = normalizeRelayUrl(rawUrl)
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
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer)
      this.watcherTimer = null
    }
    for (const conn of this.connections.values()) {
      conn.generation++
      conn.state = 'closed'
      this.resolveReadyWaiters(conn.wallet.id, false)
      if (conn.retryTimer) clearTimeout(conn.retryTimer)
      this.teardownClient(conn)
    }
    this.connections.clear()
    this.byConnectionString.clear()
    this.connectQueue = []
  }

  private requireReady(walletId: string): WalletConnection {
    const conn = this.connections.get(walletId)
    if (!conn) {
      throw new NwcPoolError(
        'wallet_not_found',
        'No pooled connection for this wallet'
      )
    }
    if (
      conn.state !== 'ready' ||
      !conn.client ||
      !isConnectedSafe(conn.client)
    ) {
      if (conn.client && conn.state === 'ready') {
        conn.state = 'disconnected'
        conn.wasConnected = false
      }
      throw new NwcPoolError(
        'wallet_not_connected',
        `Wallet connection is ${conn.state}`
      )
    }
    return conn
  }

  private mapSdkError(conn: WalletConnection, err: unknown): NwcPoolError {
    conn.lastErrorAt = new Date()
    conn.lastError = err instanceof Error ? err.message : String(err)
    if (err instanceof Nip47WalletError) {
      return new NwcPoolError('wallet_error', err.message, err.code)
    }
    if (err instanceof Nip47TimeoutError) {
      return new NwcPoolError('timeout', err.message)
    }
    if (err instanceof Nip47Error) {
      return new NwcPoolError('relay_error', err.message)
    }
    return new NwcPoolError(
      'relay_error',
      err instanceof Error ? err.message : 'Unknown NWC transport error'
    )
  }

  private resolveReadyWaiters(walletId: string, ready: boolean): void {
    const waiters = this.readyWaiters.get(walletId)
    if (!waiters) return
    for (const resolve of [...waiters]) resolve(ready)
  }
}

/**
 * Matches nostr-tools' URL normalization (its `listConnectionStatus` keys):
 * `new URL()` lowercases scheme/host and gives bare domains a trailing slash.
 */
function normalizeRelayUrl(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

function isThenable(v: unknown): v is Promise<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { then?: unknown }).then === 'function'
  )
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref()
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * `NWCClient.connected` reads `pool.listConnectionStatus()` — non-throwing in
 * practice, but this is on the dead-wallet decision path so guard it: an
 * unexpected throw reads as "not connected" (conservative — we won't archive a
 * wallet whose relay state we can't determine).
 */
function isConnectedSafe(client: NWCClient): boolean {
  try {
    return client.connected
  } catch {
    return false
  }
}
