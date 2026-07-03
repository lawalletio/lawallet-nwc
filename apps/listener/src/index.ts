// @lawallet-nwc/listener — transport-only NWC relay bridge.
// Reads ACTIVE NWC RemoteWallets from the shared Postgres, keeps live relay
// connections in a pool, forwards NIP-47 notifications to apps/web as
// HMAC-signed webhooks, and proxies NWC requests over the open connections.
// All business logic (payment matching, receipts) stays in apps/web.
import type { Nip47Notification } from '@getalby/sdk'
import { getEnv } from './env'
import { createHttpServer } from './http/server'
import { createLogger, initLogger, patchConsole } from './logger'
import { metrics } from './metrics'
import {
  createPgPool,
  loadActiveNwcWallets,
  loadActiveWalletById,
  startWalletChangeListener,
  waitForDb,
  type DesiredWallet
} from './db'
import { NwcPool } from './nwc/pool'
import {
  bootstrapStore,
  computeEventKey,
  insertEventIfNew,
  lastEventAtByWallet,
  pruneEvents,
  type StoredEvent
} from './store'
import { WebhookDispatcher } from './webhook'

async function main(): Promise<void> {
  // @getalby/sdk's relay layer needs the global WebSocket (Node >= 22).
  // Fail loudly at startup instead of silently never connecting.
  if (typeof globalThis.WebSocket === 'undefined') {
    throw new Error(
      `Node ${process.version} has no global WebSocket — the listener requires Node >= 22 (see .nvmrc).`
    )
  }
  const env = getEnv()
  const logger = initLogger(env)
  patchConsole(logger)
  const log = createLogger({ module: 'main' })

  const pgPool = createPgPool(env)
  await waitForDb(pgPool, log)
  await bootstrapStore(pgPool)
  log.info('store.bootstrapped')

  const dispatcher = new WebhookDispatcher({
    env,
    log: createLogger({ module: 'webhook' }),
    pool: pgPool,
    metrics
  })

  // Notifications older than the retention window minus a day are dropped
  // before storage — pruning must never reopen the dedup window.
  const maxAgeMs = (env.EVENT_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000

  const onNotification = (
    wallet: DesiredWallet,
    n: Nip47Notification
  ): void => {
    void handleNotification(wallet, n).catch(err =>
      log.error({ err, walletId: wallet.id }, 'notification.handler_error')
    )
  }

  async function handleNotification(
    wallet: DesiredWallet,
    n: Nip47Notification
  ): Promise<void> {
    metrics.eventsReceived++
    const tx = n.notification
    if (!tx?.payment_hash) {
      log.warn(
        { walletId: wallet.id, type: n.notification_type },
        'notification.missing_payment_hash'
      )
      return
    }

    const eventAgeRef = (tx.settled_at || tx.created_at || 0) * 1000
    if (eventAgeRef > 0 && Date.now() - eventAgeRef > maxAgeMs) {
      log.debug({ walletId: wallet.id }, 'notification.too_old_skipped')
      return
    }

    const eventKey = computeEventKey(
      wallet.id,
      n.notification_type,
      tx.payment_hash
    )
    const isNew = await insertEventIfNew(pgPool, {
      eventKey,
      walletId: wallet.id,
      notificationType: n.notification_type,
      paymentHash: tx.payment_hash,
      amountMsats: typeof tx.amount === 'number' ? tx.amount : null,
      settledAt: tx.settled_at ? new Date(tx.settled_at * 1000) : null,
      payload: tx
    })
    if (!isNew) {
      metrics.eventsDuplicate++
      return
    }

    log.info(
      { walletId: wallet.id, type: n.notification_type, eventKey },
      'notification.stored'
    )

    const stored: StoredEvent = {
      eventKey,
      walletId: wallet.id,
      notificationType: n.notification_type,
      paymentHash: tx.payment_hash,
      amountMsats: typeof tx.amount === 'number' ? tx.amount : null,
      settledAt: tx.settled_at ? new Date(tx.settled_at * 1000) : null,
      payload: tx,
      receivedAt: new Date(),
      webhookStatus: 'pending',
      webhookAttempts: 0
    }
    // Fire-and-forget: delivery failures are retried by the sweep, and must
    // never crash the notification subscriber.
    void dispatcher
      .dispatch(stored)
      .catch(err => log.error({ err, eventKey }, 'webhook.dispatch_error'))
  }

  const nwcPool = new NwcPool({
    log: createLogger({ module: 'pool' }),
    onNotification,
    onWalletError: (wallet, error) => {
      void dispatcher
        .sendListenerError(wallet.id, 'connection_failed', error.message)
        .catch(() => {})
    }
  })

  nwcPool.seedLastEventAt(await lastEventAtByWallet(pgPool))
  const wallets = await loadActiveNwcWallets(pgPool, log)
  log.info({ count: wallets.length }, 'wallets.loaded')
  await nwcPool.reconcile(wallets)
  // Re-seed: reconcile created the connections the seed applies to.
  nwcPool.seedLastEventAt(await lastEventAtByWallet(pgPool))

  const changeListener = startWalletChangeListener({
    env,
    log: createLogger({ module: 'listen' }),
    onChange: payload => {
      metrics.notifiesReceived++
      if (!payload) {
        metrics.reconciles++
        void loadActiveNwcWallets(pgPool, log)
          .then(desired => nwcPool.reconcile(desired))
          .catch(err => log.error({ err }, 'reconcile.full_failed'))
        return
      }
      void loadActiveWalletById(pgPool, payload.id, log)
        .then(row => nwcPool.reconcileOne(payload.id, row))
        .catch(err =>
          log.error({ err, walletId: payload.id }, 'reconcile.one_failed')
        )
    }
  })

  const server = createHttpServer({
    env,
    log: createLogger({ module: 'http' }),
    metrics,
    pgPool,
    nwcPool
  })
  await new Promise<void>(resolve =>
    server.listen(env.LISTENER_PORT, '0.0.0.0', resolve)
  )
  log.info({ port: env.LISTENER_PORT }, 'http.listening')

  const timers: NodeJS.Timeout[] = [
    setInterval(() => {
      metrics.reconciles++
      void loadActiveNwcWallets(pgPool, log)
        .then(desired => nwcPool.reconcile(desired))
        .catch(err => log.error({ err }, 'reconcile.periodic_failed'))
    }, env.RECONCILE_INTERVAL_MS),
    setInterval(
      () => {
        void pruneEvents(pgPool, env.EVENT_RETENTION_DAYS)
          .then(count => {
            if (count > 0) log.info({ count }, 'store.pruned')
          })
          .catch(err => log.error({ err }, 'store.prune_failed'))
      },
      60 * 60 * 1000
    ),
    setInterval(
      () => {
        void dispatcher
          .sweep()
          .catch(err => log.error({ err }, 'webhook.sweep_failed'))
      },
      5 * 60 * 1000
    )
  ]
  for (const timer of timers) timer.unref()

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'shutdown.start')
    const forceExit = setTimeout(() => {
      log.warn('shutdown.forced')
      process.exit(1)
    }, 10000)
    forceExit.unref()

    void (async () => {
      for (const timer of timers) clearInterval(timer)
      await new Promise<void>(resolve => server.close(() => resolve()))
      await changeListener.stop()
      await nwcPool.closeAll()
      await pgPool.end()
      log.info('shutdown.complete')
      process.exit(0)
    })().catch(err => {
      log.error({ err }, 'shutdown.error')
      process.exit(1)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch(err => {
  // Logger may not exist yet (env validation failures) — raw stderr is right.
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
