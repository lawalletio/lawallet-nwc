import type { Prisma } from '@/lib/generated/prisma'
import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  safeTransaction,
  TransactionConnectionError,
  TransactionTimeoutError,
  type TransactionClient
} from '@/lib/prisma-transaction'
import {
  decryptRemoteWalletConnectionString,
  encryptRemoteWalletConfig,
  isEncryptedRemoteWalletConnectionString
} from '@/lib/wallet/remote-wallet-vault'

const log = createLogger({ module: 'remote-wallet-vault-migration' })

const BATCH_SIZE = 50
const BATCH_TIMEOUT_MS = 30_000
const MAX_WAIT_MS = 5_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000

interface NwcWalletRow {
  id: string
  config: Prisma.JsonValue
  nwcConfigEncryptedAt: Date | null
}

async function acquireAdvisoryLock(tx: TransactionClient): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('lawallet:remote-wallet-nwc-v1')
    )::text AS "lock"
  `
}

async function fetchBatchForUpdate(
  tx: TransactionClient,
  offset: number,
  limit: number
): Promise<NwcWalletRow[]> {
  return tx.$queryRaw<NwcWalletRow[]>`
    SELECT "id", "config", "nwcConfigEncryptedAt"
      FROM "RemoteWallet"
     WHERE "type" = 'NWC'
     ORDER BY "id"
    OFFSET ${offset}
     LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
  `
}

function validateRow(row: NwcWalletRow): void {
  const source = row.config as Record<string, unknown> | null
  const stored = source?.connectionString
  if (typeof stored !== 'string' || !stored) {
    throw new Error(
      `NWC RemoteWallet ${row.id} has no valid config.connectionString`
    )
  }
}

function connectionStringOf(row: NwcWalletRow): string {
  const source = row.config as Record<string, unknown> | null
  const stored = source?.connectionString
  if (typeof stored !== 'string' || !stored) {
    throw new Error(
      `NWC RemoteWallet ${row.id} has no valid config.connectionString`
    )
  }
  return stored
}

function verifyEncryptedRow(row: NwcWalletRow): void {
  const stored = connectionStringOf(row)
  if (!isEncryptedRemoteWalletConnectionString(stored)) {
    return
  }
  try {
    decryptRemoteWalletConnectionString(stored, row.id)
  } catch (error) {
    throw new Error(
      `Remote wallet ${row.id} NWC vault ciphertext cannot be decrypted with the current NWC_VAULT_SECRET. Restore the secret that sealed this row, or reconnect the wallet.`,
      { cause: error }
    )
  }
}

function needsEncryption(row: NwcWalletRow): boolean {
  const stored = connectionStringOf(row)
  const needsRewrite = !isEncryptedRemoteWalletConnectionString(stored)
  return needsRewrite || row.nwcConfigEncryptedAt === null
}

async function encryptRow(
  tx: TransactionClient,
  row: NwcWalletRow
): Promise<void> {
  const source = row.config as Record<string, unknown> | null
  const stored = source?.connectionString
  if (typeof stored !== 'string' || !stored) {
    throw new Error(
      `NWC RemoteWallet ${row.id} has no valid config.connectionString`
    )
  }

  const config = encryptRemoteWalletConfig(row.id, 'NWC', row.config)
  await tx.remoteWallet.update({
    where: { id: row.id },
    data: {
      config: config as Prisma.InputJsonValue,
      nwcConfigEncryptedAt: new Date()
    }
  })
}

async function processBatch(
  vaultSecret: string,
  offset: number
): Promise<{ processed: number; hasMore: boolean }> {
  return safeTransaction(
    prisma,
    async tx => {
      await acquireAdvisoryLock(tx)
      const rows = await fetchBatchForUpdate(tx, offset, BATCH_SIZE)

      if (rows.length === 0) {
        return { processed: 0, hasMore: false }
      }

      for (const row of rows) {
        validateRow(row)
        verifyEncryptedRow(row)
      }

      let changed = 0
      for (const row of rows) {
        if (!needsEncryption(row)) continue
        await encryptRow(tx, row)
        changed++
      }

      return { processed: changed, hasMore: rows.length === BATCH_SIZE }
    },
    { timeout: BATCH_TIMEOUT_MS, maxWait: MAX_WAIT_MS }
  )
}

async function processBatchWithRetry(
  vaultSecret: string,
  offset: number,
  attempt: number = 1
): Promise<{ processed: number; hasMore: boolean }> {
  try {
    return await processBatch(vaultSecret, offset)
  } catch (error) {
    const isRetryable =
      error instanceof TransactionTimeoutError ||
      error instanceof TransactionConnectionError

    if (isRetryable && attempt < MAX_RETRIES) {
      log.warn(
        { err: error, offset, attempt, maxRetries: MAX_RETRIES },
        'remote_wallet_nwc_encryption.batch_retry'
      )
      await new Promise(resolve =>
        setTimeout(resolve, RETRY_DELAY_MS * attempt)
      )
      return processBatchWithRetry(vaultSecret, offset, attempt + 1)
    }

    throw error
  }
}

async function verifyMigrationComplete(): Promise<void> {
  const remaining = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS "count"
      FROM "RemoteWallet"
     WHERE "type" = 'NWC'
       AND (
         "nwcConfigEncryptedAt" IS NULL
         OR COALESCE("config"->>'connectionString', '') NOT LIKE 'lwrw1:%'
       )
  `
  if (Number(remaining[0]?.count ?? 0) !== 0) {
    throw new Error('Remote wallet NWC encryption migration is incomplete')
  }
}

/**
 * Mandatory, idempotent data half of the Prisma migration.
 *
 * Prisma's SQL migration adds the completion timestamp, but cannot safely
 * receive a deployment secret. Startup holds a PostgreSQL advisory lock,
 * encrypts every legacy NWC URI, verifies existing envelopes, and commits all
 * rows atomically before this application instance becomes ready.
 *
 * Processes in batches to avoid long-running transactions that can be killed
 * by Neon's idle-in-transaction timeout. Each batch is a separate transaction
 * with its own advisory lock. The advisory lock prevents concurrent batch
 * processing from causing conflicts.
 */
export async function migrateRemoteWalletNwcConfigs(): Promise<number> {
  const count = await prisma.remoteWallet.count({ where: { type: 'NWC' } })
  if (count === 0) return 0

  const vaultSecret = getConfig().nwcVault.secret
  if (!vaultSecret) {
    throw new Error(
      'NWC_VAULT_SECRET is required because RemoteWallet contains NWC connections'
    )
  }

  let totalMigrated = 0
  let offset = 0

  log.info({ totalRows: count }, 'remote_wallet_nwc_encryption.starting')

  while (true) {
    const { processed, hasMore } = await processBatchWithRetry(
      vaultSecret,
      offset
    )
    totalMigrated += processed
    offset += BATCH_SIZE

    if (processed > 0) {
      log.debug(
        { batchProcessed: processed, totalMigrated, offset },
        'remote_wallet_nwc_encryption.batch_complete'
      )
    }

    if (!hasMore) break
  }

  await verifyMigrationComplete()

  if (totalMigrated > 0) {
    log.info(
      { migrated: totalMigrated },
      'remote_wallet_nwc_encryption.completed'
    )
  }

  return totalMigrated
}
