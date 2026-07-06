// @lawallet-nwc/listener — transport-only NWC relay bridge.
// Reads ACTIVE NWC RemoteWallets from the shared Postgres, keeps live relay
// connections in a pool, forwards NIP-47 notifications to apps/web as
// HMAC-signed webhooks, and proxies NWC requests over the open connections.
// All business logic (payment matching, receipts) stays in apps/web.
import type { NWCClient, Nip47Notification } from '@getalby/sdk'
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
  waitForSchema,
  type DesiredWallet
} from './db'
import { NwcPool } from './nwc/pool'
import { CatchupRunner } from './nwc/catchup'
import {
  advanceCursor,
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
  // Fresh installs boot web + listener together — hold until web's
  // `prisma migrate deploy` has created the tables we query.
  await waitForSchema(pgPool, log)
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

  // Shared by the live stream (recovered=false) and downtime catch-up
  // (recovered=true). Returns whether the event was NEW — catch-up uses that
  // to count actual recoveries instead of dedup hits.
  async function handleNotification(
    wallet: DesiredWallet,
    n: Nip47Notification,
    recovered = false
  ): Promise<boolean> {
    metrics.eventsReceived++
    const tx = n.notification
    if (!tx?.payment_hash) {
      log.warn(
        { walletId: wallet.id, type: n.notification_type },
        'notification.missing_payment_hash'
      )
      return false
    }

    const eventAgeRef = (tx.settled_at || tx.created_at || 0) * 1000
    if (eventAgeRef > 0 && Date.now() - eventAgeRef > maxAgeMs) {
      log.debug({ walletId: wallet.id }, 'notification.too_old_skipped')
      return false
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
      payload: tx,
      recovered
    })

    // Live events move the catch-up anchor forward; catch-up runs advance it
    // themselves after covering their whole window.
    if (!recovered) {
      const seenAt =
        tx.settled_at || tx.created_at
          ? new Date((tx.settled_at || tx.created_at) * 1000)
          : new Date()
      void advanceCursor(pgPool, wallet.id, seenAt).catch(err =>
        log.debug({ err, walletId: wallet.id }, 'cursor.advance_failed')
      )
    }

    if (!isNew) {
      metrics.eventsDuplicate++
      return false
    }

    log.info(
      { walletId: wallet.id, type: n.notification_type, eventKey, recovered },
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
      recovered,
      receivedAt: new Date(),
      webhookStatus: 'pending',
      webhookAttempts: 0
    }
    // Fire-and-forget: delivery failures are retried by the sweep, and must
    // never crash the notification subscriber.
    void dispatcher
      .dispatch(stored)
      .catch(err => log.error({ err, eventKey }, 'webhook.dispatch_error'))
    return true
  }

  const catchup = new CatchupRunner({
    env,
    log: createLogger({ module: 'catchup' }),
    pool: pgPool,
    metrics,
    process: (wallet, notification) =>
      handleNotification(wallet, notification, true)
  })

  // Fired on subscribe (startup / wallet added / rotation) and on relay
  // reconnects detected by the pool watcher. runForWallet never throws
  // (it catches internally), the .catch is belt-and-suspenders.
  const runCatchup = (wallet: DesiredWallet, client: NWCClient): void => {
    void catchup
      .runForWallet(wallet, client)
      .then(() => {
        const at = catchup.getLastCatchupAt(wallet.id)
        if (at) nwcPool.noteCatchup(wallet.id, at)
      })
      .catch(err =>
        log.error({ err, walletId: wallet.id }, 'catchup.run_error')
      )
  }

  const nwcPool = new NwcPool({
    log: createLogger({ module: 'pool' }),
    onNotification,
    onWalletError: (wallet, error) => {
      void dispatcher
        .sendListenerError(wallet.id, 'connection_failed', error.message)
        .catch(() => {})
    },
    // With catch-up disabled no hooks are registered — the pool then skips
    // its reconnect watcher too (cursors still advance from live events).
    ...(env.CATCHUP_ENABLED
      ? { onSubscribed: runCatchup, onReconnected: runCatchup }
      : {})
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
      // Wallets may gain list_transactions support over time — let the next
      // catch-up retry them.
      catchup.resetUnsupported()
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
  if (env.CATCHUP_ENABLED && env.CATCHUP_INTERVAL_MS > 0) {
    // Safety net for gaps neither the subscribe hook nor the reconnect
    // watcher caught (e.g. silent SDK resubscribes between watcher samples).
    timers.push(
      setInterval(() => {
        for (const { wallet, client } of nwcPool.subscribedClients()) {
          runCatchup(wallet, client)
        }
      }, env.CATCHUP_INTERVAL_MS)
    )
  }
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
