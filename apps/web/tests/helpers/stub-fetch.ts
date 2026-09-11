import { vi } from 'vitest'

/**
 * Vitest 5 + happy-dom 20 expose `globalThis.fetch` as a read-only getter.
 * Assigning `global.fetch = vi.fn()` throws. `vi.stubGlobal` is the supported
 * replacement; pair it with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubFetch(
  impl?: Parameters<typeof vi.fn>[0]
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}
