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

/**
 * Keyset page over the rows that still need work, in id order. Plain FOR
 * UPDATE (not SKIP LOCKED): the advisory lock already serializes migrators, so
 * the only other lockers are short app writes, and skipping them would leave
 * a row behind for `verifyMigrationComplete` to trip on.
 */
async function fetchBatchForUpdate(
  tx: TransactionClient,
  afterId: string,
  limit: number
): Promise<NwcWalletRow[]> {
  return tx.$queryRaw<NwcWalletRow[]>`
    SELECT "id", "config", "nwcConfigEncryptedAt"
      FROM "RemoteWallet"
     WHERE "type" = 'NWC'
       AND "id" > ${afterId}
       AND (
         "nwcConfigEncryptedAt" IS NULL
         OR COALESCE("config"->>'connectionString', '') NOT LIKE 'lwrw1:%'
       )
     ORDER BY "id"
     LIMIT ${limit}
       FOR UPDATE
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

type RowVerdict = 'plaintext' | 'encrypted' | 'unreadable'

/**
 * Classify one row without throwing. A row sealed under a secret this
 * deployment no longer has is a per-row fault, not a deployment fault: the
 * driver path already degrades it to a 503 for that wallet alone, so it must
 * not take the whole instance down.
 */
function classifyRow(row: NwcWalletRow): RowVerdict {
  const stored = connectionStringOf(row)
  if (!isEncryptedRemoteWalletConnectionString(stored)) return 'plaintext'
  try {
    decryptRemoteWalletConnectionString(stored, row.id)
    return 'encrypted'
  } catch {
    return 'unreadable'
  }
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
  lastId: string | null
}

async function processBatch(afterId: string): Promise<BatchResult> {
  return safeTransaction(
    prisma,
    async tx => {
      await acquireAdvisoryLock(tx)
      const rows = await fetchBatchForUpdate(tx, afterId, BATCH_SIZE)

      if (rows.length === 0) {
        return { processed: 0, unreadable: [], readable: 0, lastId: null }
      }

      for (const row of rows) {
        validateRow(row)
      }

      let changed = 0
      let readable = 0
      const unreadable: string[] = []
      for (const row of rows) {
        const verdict = classifyRow(row)
        if (verdict === 'plaintext') {
          await encryptRow(tx, row)
          changed++
          continue
        }
        if (verdict === 'encrypted') readable++
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
        lastId: rows.length === BATCH_SIZE ? rows[rows.length - 1].id : null
      }
    },
    { timeout: BATCH_TIMEOUT_MS, maxWait: MAX_WAIT_MS }
  )
}

async function processBatchWithRetry(
  afterId: string,
  attempt: number = 1
): Promise<BatchResult> {
  try {
    return await processBatch(afterId)
  } catch (error) {
    const isRetryable =
      error instanceof TransactionTimeoutError ||
      error instanceof TransactionConnectionError

    if (isRetryable && attempt < MAX_RETRIES) {
      log.warn(
        { err: error, afterId, attempt, maxRetries: MAX_RETRIES },
        'remote_wallet_nwc_encryption.batch_retry'
      )
      await new Promise(resolve =>
        setTimeout(resolve, RETRY_DELAY_MS * attempt)
      )
      return processBatchWithRetry(afterId, attempt + 1)
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
 * encrypts every legacy NWC URI, verifies unstamped envelopes, and commits all
 * rows atomically before this application instance becomes ready.
 *
 * Processes in keyset-paged batches (`id > lastId`) to avoid long-running
 * transactions that can be killed by Neon's idle-in-transaction timeout. Each
 * batch is a separate transaction with its own advisory lock, which prevents
 * concurrent instances from conflicting; a batch another instance already
 * finished simply finds nothing left to do.
 */
export async function migrateRemoteWalletNwcConfigs(): Promise<number> {
  // One round trip on every cold start; the common case (nothing left to
  // migrate) returns here without a transaction, lock or decrypt.
  const [state] = await prisma.$queryRaw<
    { hasNwc: boolean; pending: boolean }[]
  >`
    SELECT
      EXISTS(SELECT 1 FROM "RemoteWallet" WHERE "type" = 'NWC') AS "hasNwc",
      EXISTS(
        SELECT 1
          FROM "RemoteWallet"
         WHERE "type" = 'NWC'
           AND (
             "nwcConfigEncryptedAt" IS NULL
             OR COALESCE("config"->>'connectionString', '') NOT LIKE 'lwrw1:%'
           )
      ) AS "pending"
  `
  if (!state?.hasNwc) return 0

  const vaultSecret = getConfig().nwcVault.secret
  if (!vaultSecret) {
    throw new Error(
      'NWC_VAULT_SECRET is required because RemoteWallet contains NWC connections'
    )
  }

  if (!state.pending) return 0

  let totalMigrated = 0
  let totalReadable = 0
  const unreadable: string[] = []
  let afterId: string | null = ''

  log.info('remote_wallet_nwc_encryption.starting')

  while (afterId !== null) {
    const batch = await processBatchWithRetry(afterId)
    totalMigrated += batch.processed
    totalReadable += batch.readable
    unreadable.push(...batch.unreadable)
    afterId = batch.lastId

    if (batch.processed > 0) {
      log.debug(
        { batchProcessed: batch.processed, totalMigrated },
        'remote_wallet_nwc_encryption.batch_complete'
      )
    }
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
