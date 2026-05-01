import type { ActivityCategory, ActivityLevel, ActivityLog } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { getCurrentReqId, logger } from '@/lib/logger'
import { eventBus } from '@/lib/events/event-bus'

export type { ActivityCategory, ActivityLevel, ActivityLog }

/**
 * Stable string codes for every event the app records. Stored verbatim in
 * `ActivityLog.event` and used as filter keys in the admin UI — renaming a
 * value silently breaks historical queries, so prefer adding new codes over
 * renaming existing ones.
 */
export const ActivityEvent = {
  // USER
  USER_JWT_ISSUED: 'user.jwt_issued',
  USER_SIGNUP: 'user.signup',
  USER_AUTH_FAILED: 'user.auth_failed',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_ERROR: 'user.error',
  // ADDRESS
  ADDRESS_CREATED: 'address.created',
  ADDRESS_UPDATED: 'address.updated',
  ADDRESS_DELETED: 'address.deleted',
  ADDRESS_ERROR: 'address.error',
  // NWC
  NWC_CONNECTION_CREATED: 'nwc.connection_created',
  NWC_DEFAULT_CHANGED: 'nwc.default_changed',
  NWC_ASSIGNED_TO_ADDRESS: 'nwc.assigned_to_address',
  NWC_RELAY_TIMEOUT: 'nwc.relay_timeout',
  NWC_CONNECTION_ERROR: 'nwc.connection_error',
  // INVOICE
  INVOICE_GENERATED: 'invoice.generated',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_EXPIRED: 'invoice.expired',
  INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
  // CARD
  CARD_DESIGN_CREATED: 'card.design_created',
  CARD_DESIGN_UPDATED: 'card.design_updated',
  CARD_CREATED: 'card.created',
  CARD_PAIRED: 'card.paired',
  CARD_STATUS_UPDATED: 'card.status_updated',
  CARD_DELETED: 'card.deleted',
  CARD_ERROR: 'card.error',
  // SERVER
  SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
  SERVER_DATABASE_ERROR: 'server.database_error',
  SERVER_MAINTENANCE_TOGGLED: 'server.maintenance_toggled',
  SERVER_SETTINGS_UPDATED: 'server.settings_updated',
} as const

export type ActivityEventCode = (typeof ActivityEvent)[keyof typeof ActivityEvent]

/**
 * Snapshot of an Invoice row suitable for attaching to an INVOICE activity log
 * entry. Captures the full business record so the admin can audit exactly what
 * was generated / paid / expired without cross-referencing another table.
 * Dates are serialized to ISO strings so the JSON metadata column round-trips
 * cleanly.
 */
export function invoiceLogMetadata(invoice: {
  id: string
  bolt11: string
  paymentHash: string
  amountSats: number
  description: string
  purpose: string
  status: string
  preimage: string | null
  metadata: unknown
  userId: string | null
  expiresAt: Date | string | null | undefined
  paidAt: Date | string | null | undefined
  createdAt: Date | string | null | undefined
}) {
  return {
    invoiceId: invoice.id,
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    amountSats: invoice.amountSats,
    description: invoice.description,
    purpose: invoice.purpose,
    status: invoice.status,
    preimage: invoice.preimage,
    invoiceMetadata: invoice.metadata ?? null,
    userId: invoice.userId,
    expiresAt: toIso(invoice.expiresAt),
    paidAt: toIso(invoice.paidAt),
    createdAt: toIso(invoice.createdAt),
  }
}

// Accept Date, string, or null/undefined so the helper is robust to test
// mocks that don't round-trip timestamps as Date objects. Returns null for
// missing values so the log row remains inspectable even with partial data.
function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/** Input shape for {@link logActivity} — `level` defaults to `'INFO'`. */
export interface LogActivityInput {
  category: ActivityCategory
  event: ActivityEventCode | string
  message: string
  level?: ActivityLevel
  userId?: string | null
  metadata?: Record<string, unknown> | null
}

function levelToPinoMethod(level: ActivityLevel): 'info' | 'warn' | 'error' {
  switch (level) {
    case 'ERROR':
      return 'error'
    case 'WARN':
      return 'warn'
    default:
      return 'info'
  }
}

async function logActivityImpl(input: LogActivityInput): Promise<ActivityLog> {
  const level: ActivityLevel = input.level ?? 'INFO'
  const reqId = getCurrentReqId() ?? null

  const row = await prisma.activityLog.create({
    data: {
      category: input.category,
      level,
      event: input.event,
      message: input.message,
      reqId,
      userId: input.userId ?? null,
      metadata: (input.metadata ?? undefined) as never,
    },
  })

  // Mirror into Pino so log aggregators see the same event line, tagged so
  // ops dashboards can filter activity vs. pure debug traffic.
  const pino = logger.child({
    activity: true,
    category: input.category,
    event: input.event,
    level,
    userId: input.userId ?? undefined,
  })
  const method = levelToPinoMethod(level)
  pino[method]({ metadata: input.metadata ?? undefined }, input.message)

  // Push to SSE subscribers so the admin UI updates live.
  try {
    eventBus.emit({
      type: 'activity:new',
      timestamp: row.createdAt.getTime(),
      log: row,
    })
  } catch {
    // Best-effort; a broken SSE client must not fail the write.
  }

  return row
}

/**
 * Persists an `ActivityLog` row, mirrors the line into Pino, and broadcasts an
 * `activity:new` SSE event. Awaitable when the caller needs the row id.
 */
export async function logActivity(input: LogActivityInput): Promise<ActivityLog> {
  return logActivityImpl(input)
}

/**
 * Fire-and-forget variant. Use from hot paths where logging must never throw
 * or block — a broken DB connection for the `ActivityLog` table should not
 * kill the user-facing request. Errors are caught and logged via Pino.
 */
logActivity.fireAndForget = (input: LogActivityInput): void => {
  logActivityImpl(input).catch(err => {
    logger.error({ err, activity_input: input }, 'activity_log.write_failed')
  })
}
