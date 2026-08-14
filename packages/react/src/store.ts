/**
 * Minimal per-provider resource cache: one entry per key with in-flight
 * dedupe and subscriber notification. Deliberately tiny — SSE events and
 * mutations call `invalidate`, which re-triggers any mounted hook.
 */

export interface ResourceEntry<T = unknown> {
  data: T | undefined
  error: Error | null
  loading: boolean
}

const EMPTY: ResourceEntry = { data: undefined, error: null, loading: false }

export class ResourceStore {
  private entries = new Map<string, ResourceEntry>()
  private inflight = new Map<string, Promise<void>>()
  private listeners = new Map<string, Set<() => void>>()

  get(key: string): ResourceEntry {
    return this.entries.get(key) ?? EMPTY
  }

  subscribe(key: string, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      set.delete(listener)
    }
  }

  private notify(key: string) {
    for (const listener of this.listeners.get(key) ?? []) listener()
  }

  private set(key: string, entry: ResourceEntry) {
    this.entries.set(key, entry)
    this.notify(key)
  }

  /** Fetches (with in-flight dedupe) and stores the result under `key`. */
  fetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
    const pending = this.inflight.get(key)
    if (pending) return pending

    this.set(key, { ...this.get(key), loading: true })
    const promise = fetcher()
      .then(data => {
        this.set(key, { data, error: null, loading: false })
      })
      .catch((error: unknown) => {
        this.set(key, {
          ...this.get(key),
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false
        })
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, promise)
    return promise
  }

  /** Drops every entry whose key starts with `prefix` and notifies its hooks. */
  invalidate(prefix: string) {
    for (const key of [...this.entries.keys()]) {
      if (key === prefix || key.startsWith(prefix)) {
        this.entries.delete(key)
        this.notify(key)
      }
    }
  }

  /** Full wipe — login/logout. */
  clear() {
    const keys = [...this.entries.keys()]
    this.entries.clear()
    for (const key of keys) this.notify(key)
  }
}
