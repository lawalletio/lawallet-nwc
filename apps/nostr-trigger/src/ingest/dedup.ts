import { getRedis } from '../redis/client.js'
import { redisKeys } from '../redis/keys.js'
import { getConfig } from '../config/index.js'

/**
 * Atomically claims an event id. Returns true iff this call was the first to
 * see it (within the dedup TTL window). Use this to drop duplicate events
 * observed across multiple relays.
 */
export async function claimEventId(eventId: string): Promise<boolean> {
  const redis = getRedis()
  const ttl = getConfig().runtime.dedupTtlSeconds
  const result = await redis.set(redisKeys.dedup(eventId), '1', 'EX', ttl, 'NX')
  return result === 'OK'
}

export async function hasSeenEventId(eventId: string): Promise<boolean> {
  const redis = getRedis()
  return (await redis.exists(redisKeys.dedup(eventId))) === 1
}
