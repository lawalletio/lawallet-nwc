export const TREASURE_CHEST_SRC = '/animations/treasure-chest.lottie'
/**
 * Self-hosted dotlottie player runtime (1.2MB) instead of the jsDelivr /
 * unpkg default. The file name carries the `@lottiefiles/dotlottie-web`
 * version; `treasure-chest-wasm.test.ts` fails when the dependency moves
 * so the copy can't drift — re-copy `dist/dotlottie-player.wasm` then.
 */
export const DOTLOTTIE_WASM_SRC = '/animations/dotlottie-player-0.80.0.wasm'

const CACHE_NAME = 'lawallet-lottie-v1'

let memory: ArrayBuffer | null = null
let pending: Promise<ArrayBuffer> | null = null

/**
 * Downloads the claim chest once per page and keeps the bytes in Cache
 * Storage so the next visit can play it without hitting the network.
 * Called when the withdraw screen opens; later callers share the promise.
 */
export function preloadTreasureChest(): Promise<ArrayBuffer> {
  if (memory) return Promise.resolve(memory)
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Treasure chest preload runs in the browser')
    )
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
