import type { RemoteWalletType } from '@/lib/generated/prisma'
import { getConfig } from '@/lib/config'
import {
  decryptRemoteWalletEnvelope,
  encryptRemoteWalletEnvelope,
  isRemoteWalletVaultEnvelope,
  RemoteWalletVaultDecryptError
} from '@/lib/wallet/remote-wallet-vault-core'

export { RemoteWalletVaultDecryptError }

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

export function decryptRemoteWalletConnectionString(
  stored: string,
  walletId: string
): string {
  if (!isEncryptedRemoteWalletConnectionString(stored)) return stored
  const { secret, previousSecrets } = getConfig().nwcVault
  return decryptRemoteWalletEnvelope(
    stored,
    walletId,
    secret ? [secret, ...previousSecrets] : []
  )
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
