import type { Prisma } from '@/lib/generated/prisma'
import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  encryptRemoteWalletConfig,
  isEncryptedRemoteWalletConnectionString
} from '@/lib/wallet/remote-wallet-vault'

const log = createLogger({ module: 'remote-wallet-vault-migration' })
const MIGRATION_TIMEOUT_MS = 120_000

interface NwcWalletRow {
  id: string
  config: Prisma.JsonValue
  nwcConfigEncryptedAt: Date | null
}

/**
 * Mandatory, idempotent data half of the Prisma migration.
 *
 * Prisma's SQL migration adds the completion timestamp, but cannot safely
 * receive a deployment secret. Startup holds a PostgreSQL advisory lock,
 * encrypts every legacy NWC URI, verifies existing envelopes, and commits all
 * rows atomically before this application instance becomes ready.
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

  const migrated = await prisma.$transaction(
    async tx => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('lawallet:remote-wallet-nwc-v1')
        )::text AS "lock"
      `
      const rows = await tx.$queryRaw<NwcWalletRow[]>`
        SELECT "id", "config", "nwcConfigEncryptedAt"
          FROM "RemoteWallet"
         WHERE "type" = 'NWC'
         ORDER BY "id"
         FOR UPDATE
      `

      let changed = 0
      for (const row of rows) {
        const source = row.config as Record<string, unknown> | null
        const stored = source?.connectionString
        if (typeof stored !== 'string' || !stored) {
          throw new Error(
            `NWC RemoteWallet ${row.id} has no valid config.connectionString`
          )
        }

        const config = encryptRemoteWalletConfig(row.id, 'NWC', row.config)
        const needsRewrite = !isEncryptedRemoteWalletConnectionString(stored)
        if (needsRewrite || row.nwcConfigEncryptedAt === null) {
          await tx.remoteWallet.update({
            where: { id: row.id },
            data: {
              config: config as Prisma.InputJsonValue,
              nwcConfigEncryptedAt: new Date()
            }
          })
          changed++
        }
      }
      return changed
    },
    { timeout: MIGRATION_TIMEOUT_MS }
  )

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
  if (migrated > 0) {
    log.info({ migrated }, 'remote_wallet_nwc_encryption.completed')
  }
  return migrated
}
