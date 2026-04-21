import { getConfig } from './config/index.js'
import { logger, createChildLogger } from './logger.js'
import { getRedis, closeRedis } from './redis/client.js'
import { prisma } from './db/prisma.js'
import { RelayPool } from './nostr/pool.js'
import { ConnectionManager } from './nostr/subscription-manager.js'
import { ZapReceiptPublisher } from './nostr/zap-publisher.js'
import { NostrControlPlane } from './nostr/control-plane.js'
import { createHandlers } from './commands/handlers.js'
import { buildServer } from './http/server.js'
import { startWebhookWorker, closeQueue } from './webhooks/queue.js'
import { NwcChangeListener } from './db/change-listener.js'

const log = createChildLogger({ module: 'bootstrap' })

async function main(): Promise<void> {
  const config = getConfig()
  logger() // triggers logger init so config errors surface
  log.info({ env: config.env, port: config.http.port }, 'starting nostr-trigger')

  if (config.security.dangerouslyFree) {
    log.warn(
      '================================================================'
    )
    log.warn(
      'DANGEROUSLY_FREE=true — HTTP Bearer auth and Nostr admin checks'
    )
    log.warn(
      'are DISABLED. Anyone who can reach the HTTP port or the Nostr'
    )
    log.warn(
      'service pubkey can run any command. Do NOT use in production.'
    )
    log.warn(
      '================================================================'
    )
  }

  // DB
  await prisma.$connect()
  log.info('postgres connected')

  // Redis
  const redis = getRedis()
  await redis.ping()
  log.info('redis connected')

  // Nostr pool + managers
  const pool = new RelayPool()
  const zapPublisher = new ZapReceiptPublisher(pool)
  const connectionManager = new ConnectionManager(pool)

  // Command handlers (dep injection)
  const handlers = createHandlers({
    connectionManager,
    zapPublisher,
    relayPool: pool
  })

  // BullMQ worker
  startWebhookWorker()
  log.info('webhook worker started')

  // Load persisted NWC subs
  await connectionManager.start()

  // Postgres LISTEN — react to out-of-band NwcConnection row changes
  const changeListener = new NwcChangeListener(connectionManager)
  await changeListener.start()
  log.info('pg change listener running')

  // Nostr control plane (DMs)
  const controlPlane = new NostrControlPlane(pool, handlers)
  controlPlane.start()
  log.info({ servicePubkey: controlPlane.pubkey() }, 'nostr control plane running')

  // HTTP (Bun.serve — this file is run by `bun`)
  const app = buildServer(handlers)
  const server = Bun.serve({ fetch: app.fetch, port: config.http.port })
  log.info(`http listening on :${config.http.port}`)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down')
    try {
      server.stop(true)
      pool.closeAll()
      await changeListener.stop()
      await closeQueue()
      await closeRedis()
      await prisma.$disconnect()
    } catch (err) {
      log.error({ err }, 'error during shutdown')
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(err => {
  createChildLogger({ module: 'bootstrap' }).fatal(
    { err },
    'fatal error during startup'
  )
  process.exit(1)
})
