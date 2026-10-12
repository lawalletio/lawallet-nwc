import { getEnvVar } from '@/lib/config/env'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const DAY_MS = 24 * 60 * 60 * 1000
/** Retention runs from a 10-minute tick; once an hour is plenty. */
export const RETENTION_RUN_INTERVAL_MS = 60 * 60 * 1000
/** Settings row whose `updatedAt` records the last run (and claims the next). */
export const RETENTION_SETTING = 'maintenance_retention_last_run'
/**
 * Delivery rows double as the (notification, eventKey) dedup key. The listener
 * drops notifications older than its own retention (30 days by default), so
 * keeping deliveries longer than that means pruning can't re-notify anyone.
 */
const MIN_DELIVERY_RETENTION_DAYS = 31

const BATCH_SIZE = 1000
/** Bounds one run; a large backlog drains over the next hourly runs. */
const MAX_BATCHES = 20

export interface RetentionResult {
  activityLogs: number
  forwardingHops: number
  notificationDeliveries: number
}

/**
 * Prune history tables that otherwise grow forever. Small `LIMIT`ed deletes
 * keep each statement's locks short. Returns null when skipped (disabled, or
 * another run happened within the last hour).
 */
export async function runRetention(
  now = new Date()
): Promise<RetentionResult | null> {
  const days = getEnvVar('DATA_RETENTION_DAYS')
  if (days === 0) return null
  if (!(await claimRetentionRun(now))) return null

  const cutoff = new Date(now.getTime() - days * DAY_MS)
  const deliveryCutoff = new Date(
    now.getTime() - Math.max(days, MIN_DELIVERY_RETENTION_DAYS) * DAY_MS
  )
  const result: RetentionResult = {
    activityLogs: await deleteInBatches(() =>
      prisma.activityLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
        limit: BATCH_SIZE
      })
    ),
    forwardingHops: await deleteInBatches(() =>
      prisma.forwardingHop.deleteMany({
        where: { createdAt: { lt: cutoff } },
        limit: BATCH_SIZE
      })
    ),
    // Attempts cascade with their delivery. Only finished deliveries: READY,
    // PENDING and REJECTED are still being worked, UNKNOWN awaits a person.
    notificationDeliveries: await deleteInBatches(() =>
      prisma.remoteWalletNotificationDelivery.deleteMany({
        where: {
          status: { in: ['SUCCEEDED', 'EXPIRED'] },
          updatedAt: { lt: deliveryCutoff }
        },
        limit: BATCH_SIZE
      })
    )
  }
  logger.info({ ...result, retentionDays: days }, 'maintenance.retention_run')
  return result
}

async function deleteInBatches(
  deleteBatch: () => Promise<{ count: number }>
): Promise<number> {
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { count } = await deleteBatch()
    deleted += count
    if (count < BATCH_SIZE) break
  }
  return deleted
}

/**
 * Atomically claims this hour's run. The conditional upsert locks the row, so
 * of two overlapping ticks (or serverless instances) only one gets a row back.
 */
async function claimRetentionRun(now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - RETENTION_RUN_INTERVAL_MS)
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    INSERT INTO "Settings" ("name", "value", "createdAt", "updatedAt")
    VALUES (${RETENTION_SETTING}, ${now.toISOString()}, ${now}, ${now})
    ON CONFLICT ("name") DO UPDATE
      SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "Settings"."updatedAt" <= ${staleBefore}
    RETURNING "name"
  `
  return rows.length > 0
}
