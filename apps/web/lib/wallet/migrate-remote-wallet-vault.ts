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
  isEncryptedRemoteWalletConnectionString,
  opensWithActiveNwcSecret
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

type RowVerdict = 'plaintext' | 'stale-secret' | 'current' | 'unreadable'

/**
 * Classify one row without throwing. A row sealed under a secret this
 * deployment no longer has is a per-row fault, not a deployment fault: the
 * driver path already degrades it to a 503 for that wallet alone, so it must
 * not take the whole instance down.
 */
function classifyRow(row: NwcWalletRow): RowVerdict {
  const stored = connectionStringOf(row)
  if (!isEncryptedRemoteWalletConnectionString(stored)) return 'plaintext'
  if (opensWithActiveNwcSecret(stored, row.id)) return 'current'
  try {
    decryptRemoteWalletConnectionString(stored, row.id)
    // Opened with an NWC_VAULT_SECRET_PREVIOUS entry — re-seal it so the
    // rotation can finish and the previous secret can be dropped.
    return 'stale-secret'
  } catch {
    return 'unreadable'
  }
}

async function encryptRow(
  tx: TransactionClient,
  row: NwcWalletRow,
  reseal = false
): Promise<void> {
  const source = row.config as Record<string, unknown> | null
  const stored = source?.connectionString
  if (typeof stored !== 'string' || !stored) {
    throw new Error(
      `NWC RemoteWallet ${row.id} has no valid config.connectionString`
    )
  }

  // `encryptRemoteWalletConfig` leaves an existing envelope alone, so a row
  // sealed under a previous secret has to be opened before it can be re-sealed.
  const plaintextConfig = reseal
    ? {
        ...source,
        connectionString: decryptRemoteWalletConnectionString(stored, row.id)
      }
    : row.config

  const config = encryptRemoteWalletConfig(row.id, 'NWC', plaintextConfig)
  await tx.remoteWallet.update({
    where: { id: row.id },
    data: {
      config: config as Prisma.InputJsonValue,
      nwcConfigEncryptedAt: new Date()
    }
  })
}

/**
 * The timestamp records that the envelope was written, not that this
 * deployment can still open it — so an unreadable row is stamped too and
 * reported separately instead of being retried on every boot.
 */
async function stampRow(
  tx: TransactionClient,
  row: NwcWalletRow
): Promise<void> {
  await tx.remoteWallet.update({
    where: { id: row.id },
    data: { nwcConfigEncryptedAt: new Date() }
  })
}

interface BatchResult {
  processed: number
  unreadable: string[]
  readable: number
  hasMore: boolean
}

async function processBatch(offset: number): Promise<BatchResult> {
  return safeTransaction(
    prisma,
    async tx => {
      await acquireAdvisoryLock(tx)
      const rows = await fetchBatchForUpdate(tx, offset, BATCH_SIZE)

      if (rows.length === 0) {
        return { processed: 0, unreadable: [], readable: 0, hasMore: false }
      }

      for (const row of rows) {
        validateRow(row)
      }

      let changed = 0
      let readable = 0
      const unreadable: string[] = []
      for (const row of rows) {
        const verdict = classifyRow(row)
        if (verdict === 'plaintext' || verdict === 'stale-secret') {
          await encryptRow(tx, row, verdict === 'stale-secret')
          changed++
          continue
        }
        if (verdict === 'current') readable++
        else unreadable.push(row.id)
        if (row.nwcConfigEncryptedAt === null) {
          await stampRow(tx, row)
          changed++
        }
      }

      return {
        processed: changed,
        unreadable,
        readable,
        hasMore: rows.length === BATCH_SIZE
      }
    },
    { timeout: BATCH_TIMEOUT_MS, maxWait: MAX_WAIT_MS }
  )
}

async function processBatchWithRetry(
  offset: number,
  attempt: number = 1
): Promise<BatchResult> {
  try {
    return await processBatch(offset)
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
      return processBatchWithRetry(offset, attempt + 1)
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
  let totalReadable = 0
  const unreadable: string[] = []
  let offset = 0

  log.info({ totalRows: count }, 'remote_wallet_nwc_encryption.starting')

  while (true) {
    const batch = await processBatchWithRetry(offset)
    totalMigrated += batch.processed
    totalReadable += batch.readable
    unreadable.push(...batch.unreadable)
    offset += BATCH_SIZE

    if (batch.processed > 0) {
      log.debug(
        { batchProcessed: batch.processed, totalMigrated, offset },
        'remote_wallet_nwc_encryption.batch_complete'
      )
    }

    if (!batch.hasMore) break
  }

  await verifyMigrationComplete()

  if (unreadable.length > 0) {
    log.error(
      {
        unreadableCount: unreadable.length,
        readableCount: totalReadable,
        walletIds: unreadable.slice(0, 20)
      },
      'remote_wallet_nwc_encryption.unreadable_rows'
    )
  }

  if (totalMigrated > 0) {
    log.info(
      { migrated: totalMigrated },
      'remote_wallet_nwc_encryption.completed'
    )
  }

  return totalMigrated
}
