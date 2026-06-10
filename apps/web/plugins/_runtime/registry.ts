import type { LawalletPlugin } from './types'

/**
 * Module-level plugin registry — plugins self-register at import time via
 * `plugins/index.ts`, exactly like `lib/wallet/drivers/registry.ts`. One per
 * process; lookups are cheap synchronous map reads.
 */
const registry = new Map<string, LawalletPlugin>()

const ID_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Register a plugin. Idempotent — re-registering the same id overwrites,
 * which is what tests want when they stub a plugin.
 */
export function registerPlugin(plugin: LawalletPlugin<any>): void {
  if (!ID_PATTERN.test(plugin.id)) {
    throw new Error(
      `Invalid plugin id "${plugin.id}" — must match ${ID_PATTERN}`
    )
  }
  registry.set(plugin.id, plugin)
}

/** Remove a plugin (test-only escape hatch). */
export function unregisterPlugin(id: string): void {
  registry.delete(id)
}

/** Look up a plugin by id, or undefined when not registered. */
export function getPlugin(id: string): LawalletPlugin | undefined {
  return registry.get(id)
}

/** Snapshot of all registered plugins, in registration order. */
export function listPlugins(): LawalletPlugin[] {
  return [...registry.values()]
}
