import type { RemoteWalletType } from '@/lib/generated/prisma'
import { DriverConfigError, UnsupportedDriverError } from './errors'
import type { RemoteWalletDriver } from './types'

/**
 * Module-level registry — drivers register themselves at import time via
 * `./index.ts`. Keeping it module-level (not a class) means there's exactly
 * one in the process and lookups are cheap synchronous map reads.
 */
const registry = new Map<RemoteWalletType, RemoteWalletDriver>()

/**
 * Register a driver implementation. Idempotent — re-registering the same
 * type overwrites the previous entry, which is what tests want when they
 * stub a driver.
 */
export function registerDriver(driver: RemoteWalletDriver): void {
  registry.set(driver.type, driver)
}

/** Remove a driver (test-only escape hatch). */
export function unregisterDriver(type: RemoteWalletType): void {
  registry.delete(type)
}

/** Snapshot of registered driver types. Mostly for diagnostics / tests. */
export function listDriverTypes(): RemoteWalletType[] {
  return [...registry.keys()]
}

/**
 * Look up a driver by type. Throws {@link UnsupportedDriverError} if the
 * type isn't registered — callers should let this propagate to the API
 * boundary rather than handle it locally; an unregistered type is a deploy
 * bug, not a user-facing condition.
 */
export function getDriver(type: RemoteWalletType): RemoteWalletDriver {
  const driver = registry.get(type)
  if (!driver) throw new UnsupportedDriverError(type)
  return driver
}

/**
 * Resolve a driver **and** validated config for a stored `RemoteWallet` row.
 * Returns the typed pair so call sites can immediately invoke
 * `driver.getBalance(config)` / `driver.payInvoice(config, …)` without an
 * extra cast.
 *
 * @throws {UnsupportedDriverError} if no driver is registered for the type.
 * @throws {DriverConfigError} if the stored `config` JSON doesn't match the
 *         driver's schema (corrupt row).
 */
export function driverForWallet(wallet: {
  type: RemoteWalletType
  config: unknown
}): { driver: RemoteWalletDriver<unknown>; config: unknown } {
  const driver = getDriver(wallet.type)
  const parsed = driver.configSchema.safeParse(wallet.config)
  if (!parsed.success) {
    throw new DriverConfigError(wallet.type, parsed.error.issues)
  }
  return { driver, config: parsed.data }
}
