import { getRedis } from '../redis/client.js'
import { redisKeys } from '../redis/keys.js'

/**
 * Returns the last created_at observed for (nwcId, relayUrl), in unix seconds,
 * or null if unset. Used to compute `since` when restarting subscriptions.
 */
export async function getCursor(
  nwcId: string,
  relayUrl: string
): Promise<number | null> {
  const raw = await getRedis().get(redisKeys.cursor(nwcId, relayUrl))
  if (!raw) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Updates cursor only if candidate > current. Avoids races where an older
 * event from a slower relay would move the cursor backwards.
 */
export async function advanceCursor(
  nwcId: string,
  relayUrl: string,
  createdAt: number
): Promise<void> {
  const key = redisKeys.cursor(nwcId, relayUrl)
  const redis = getRedis()
  const current = await redis.get(key)
  if (!current || parseInt(current, 10) < createdAt) {
    await redis.set(key, String(createdAt))
  }
}
