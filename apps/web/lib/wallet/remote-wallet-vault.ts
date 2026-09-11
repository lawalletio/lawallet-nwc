import type { RemoteWalletType } from '@/lib/generated/prisma'
import { getConfig } from '@/lib/config'
import { DriverConfigError } from '@/lib/wallet/drivers/errors'
import {
  decryptRemoteWalletEnvelope,
  encryptRemoteWalletEnvelope,
  isRemoteWalletVaultEnvelope,
  RemoteWalletVaultDecryptError
} from '@/lib/wallet/remote-wallet-vault-core'

export { RemoteWalletVaultDecryptError }

const VAULT_SECRET_UNCONFIGURED = 'NWC_VAULT_SECRET is not configured'

function asConfigObject(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Remote wallet config must be a JSON object')
  }
  return config as Record<string, unknown>
}

export function isEncryptedRemoteWalletConnectionString(
  value: unknown
): value is string {
  return isRemoteWalletVaultEnvelope(value)
}

export function encryptRemoteWalletConnectionString(
  plaintext: string,
  walletId: string
): string {
  const { secret } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')
  return encryptRemoteWalletEnvelope(plaintext, walletId, secret)
}

/**
 * Active secret first, then each `NWC_VAULT_SECRET_PREVIOUS` entry, so a
 * rotation can be completed online instead of stranding every credential.
 */
function vaultSecretChain(): string[] {
  const { secret, previousSecrets } = getConfig().nwcVault
  return secret ? [secret, ...previousSecrets] : []
}

export function decryptRemoteWalletConnectionString(
  stored: string,
  walletId: string
): string {
  if (!isEncryptedRemoteWalletConnectionString(stored)) return stored
  return decryptRemoteWalletEnvelope(stored, walletId, vaultSecretChain())
}

/**
 * Whether the envelope opens under the *active* secret specifically. Rows that
 * only open under a previous secret still work, but startup re-seals them.
 */
export function opensWithActiveNwcSecret(
  stored: string,
  walletId: string
): boolean {
  const { secret } = getConfig().nwcVault
  if (!secret) return false
  try {
    decryptRemoteWalletEnvelope(stored, walletId, [secret])
    return true
  } catch {
    return false
  }
}

/** Encrypts only NWC's secret field while preserving queryable config fields. */
export function encryptRemoteWalletConfig(
  walletId: string,
  type: RemoteWalletType,
  config: unknown
): Record<string, unknown> {
  const source = asConfigObject(config)
  if (type !== 'NWC') return { ...source }

  const connectionString = source.connectionString
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new Error('NWC remote wallet config has no connectionString')
  }
  if (isEncryptedRemoteWalletConnectionString(connectionString)) {
    // Verify that an existing envelope is readable and bound to this row.
    decryptRemoteWalletConnectionString(connectionString, walletId)
    return { ...source }
  }
  return {
    ...source,
    connectionString: encryptRemoteWalletConnectionString(
      connectionString,
      walletId
    )
  }
}

/** Returns a short-lived plaintext copy for a driver or authorized response. */
export function decryptRemoteWalletConfig(
  walletId: string,
  type: RemoteWalletType,
  config: unknown
): Record<string, unknown> {
  const source = asConfigObject(config)
  if (type !== 'NWC') return { ...source }

  const connectionString = source.connectionString
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new Error('NWC remote wallet config has no connectionString')
  }
  return {
    ...source,
    connectionString: decryptRemoteWalletConnectionString(
      connectionString,
      walletId
    )
  }
}

/**
 * Decrypt a persisted row for driver / payment-route use. Per-row corruption
 * (tampered envelope, malformed JSON, missing NWC URI) becomes
 * {@link DriverConfigError} so API routes that already catch `DriverError`
 * can map it to 503. A missing `NWC_VAULT_SECRET` stays a plain Error so it
 * remains a 500 + Sentry page.
 */
export function decryptRemoteWalletConfigForDriver(
  walletId: string,
  type: RemoteWalletType,
  config: unknown
): Record<string, unknown> {
  try {
    return decryptRemoteWalletConfig(walletId, type, config)
  } catch (err) {
    if (err instanceof Error && err.message === VAULT_SECRET_UNCONFIGURED) {
      throw err
    }
    if (
      err instanceof RemoteWalletVaultDecryptError ||
      (err instanceof Error &&
        (err.message === 'Remote wallet config must be a JSON object' ||
          err.message === 'NWC remote wallet config has no connectionString'))
    ) {
      throw new DriverConfigError(type, err.message)
    }
    throw err
  }
}
