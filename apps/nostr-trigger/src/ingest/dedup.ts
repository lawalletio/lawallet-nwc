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

/**
 * Atomically claims a (nwcId, notificationType, paymentHash) tuple. Used to
 * drop the second NWC notification when a wallet (e.g. Alby) publishes both
 * kind-23196 AND kind-23197 variants of the SAME payment notification —
 * they have distinct event ids but identical payload semantics.
 */
export async function claimPaymentNotification(
  nwcConnectionId: string,
  notificationType: string,
  paymentHash: string
): Promise<boolean> {
  const redis = getRedis()
  const ttl = getConfig().runtime.dedupTtlSeconds
  const key = `nt:pmt:${nwcConnectionId}:${notificationType}:${paymentHash}`
  const result = await redis.set(key, '1', 'EX', ttl, 'NX')
  return result === 'OK'
}
