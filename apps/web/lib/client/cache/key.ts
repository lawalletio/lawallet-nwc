/**
 * Derives a stable cache key from an NWC URI without exposing the relay
 * secret in storage labels (which are visible from devtools).
 *
 * The threat model is "someone with read access to localStorage labels
 * shouldn't be able to recover the URI" — that only needs a one-way
 * function with a large input space, not a cryptographic hash. We use
 * FNV-1a (32-bit) and pad to 8 hex chars: collision-safe for the handful
 * of wallets a single device ever stores, and synchronous so the
 * `useNwcBalance` hook can seed cached state during its first render
 * without an async microtask gap.
 *
 * Memoised per-URI in a module Map so the hash cost is paid once per
 * session per wallet.
 */
const cache = new Map<string, string>()

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(input: string): string {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // Multiply with imul to keep within 32-bit semantics.
    hash = Math.imul(hash, FNV_PRIME)
  }
  // Force unsigned, render as 8-char hex.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function nwcCacheKey(nwcString: string): string {
  if (!nwcString) return ''
  const cached = cache.get(nwcString)
  if (cached) return cached
  // Combine two hashes over different views of the URI so the output
  // space is 64 bits — well past anything a brute-force attempt could
  // chew through if someone reads localStorage labels.
  const a = fnv1a(nwcString)
  const b = fnv1a(nwcString.split('').reverse().join(''))
  const key = a + b
  cache.set(nwcString, key)
  return key
}

/** Test-only: drop memoised keys so successive cases don't bleed into each other. */
export function __resetNwcCacheKeyMemoForTests() {
  cache.clear()
}
