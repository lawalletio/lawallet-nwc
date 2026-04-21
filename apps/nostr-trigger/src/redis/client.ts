import Redis, { type Redis as RedisClient } from 'ioredis'
import { getConfig } from '../config/index.js'
import { createChildLogger } from '../logger.js'

const log = createChildLogger({ module: 'redis' })

let client: RedisClient | null = null
let subscriberClient: RedisClient | null = null

export function getRedis(): RedisClient {
  if (client) return client
  const { redisUrl } = getConfig().storage
  client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false
  })
  client.on('error', err => log.error({ err }, 'redis error'))
  client.on('connect', () => log.info('redis connected'))
  client.on('reconnecting', () => log.warn('redis reconnecting'))
  return client
}

/**
 * A separate connection is required for operations BullMQ uses in blocking mode
 * (BRPOPLPUSH, XREAD, etc.). ioredis forbids reusing a subscriber/blocking
 * connection for other commands.
 */
export function getBlockingRedis(): RedisClient {
  if (subscriberClient) return subscriberClient
  const { redisUrl } = getConfig().storage
  subscriberClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  })
  return subscriberClient
}

export async function closeRedis(): Promise<void> {
  await Promise.all([client?.quit(), subscriberClient?.quit()])
  client = null
  subscriberClient = null
}
