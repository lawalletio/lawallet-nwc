export const TREASURE_CHEST_SRC = '/animations/treasure-chest.lottie'

const CACHE_NAME = 'lawallet-lottie-v1'

let memory: ArrayBuffer | null = null
let pending: Promise<ArrayBuffer> | null = null

/**
 * Downloads the claim chest once per page and keeps the bytes in Cache
 * Storage so the next visit can play it without hitting the network.
 * Safe to call at app start; later callers share the same promise.
 */
export function preloadTreasureChest(): Promise<ArrayBuffer> {
  if (memory) return Promise.resolve(memory)
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Treasure chest preload runs in the browser'))
  }
  if (!pending) {
    pending = load()
      .then(buffer => {
        memory = buffer
        return buffer
      })
      .catch(error => {
        pending = null
        throw error
      })
  }
  return pending
}

async function load(): Promise<ArrayBuffer> {
  const cached = await readCache()
  if (cached) return cached

  const response = await fetch(TREASURE_CHEST_SRC)
  if (!response.ok) {
    throw new Error(`Treasure chest failed to load (${response.status})`)
  }
  const buffer = await response.arrayBuffer()
  void writeCache(buffer)
  return buffer
}

async function readCache(): Promise<ArrayBuffer | null> {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(TREASURE_CHEST_SRC)
    if (!hit) return null
    return await hit.arrayBuffer()
  } catch {
    return null
  }
}

async function writeCache(buffer: ArrayBuffer): Promise<void> {
  if (!('caches' in window)) return
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(TREASURE_CHEST_SRC, new Response(buffer.slice(0)))
  } catch {
    // A private mode that blocks Cache Storage can still play from memory.
  }
}
