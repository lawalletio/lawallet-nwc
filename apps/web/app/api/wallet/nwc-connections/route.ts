import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, ConflictError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createNwcConnectionSchema } from '@/lib/validation/schemas'
import { parseNwc } from '@/lib/client/nwc'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Shape returned on create — matches the `WalletNwcConnectionSummary` the
 * detail endpoint already ships so the client hook can splice the row into
 * its cached `connections` array without a refetch if it wants to.
 */
export interface WalletNwcConnectionSummaryDto {
  id: string
  mode: 'RECEIVE' | 'SEND_RECEIVE'
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

/**
 * POST /api/wallet/nwc-connections
 *
 * Create a new NWCConnection owned by the authenticated caller. Used by the
 * address edit page's "Custom NWC" flow so users can paste/scan a connection
 * string inline instead of bouncing to a separate setup screen.
 *
 * Request body (validated by `createNwcConnectionSchema`):
 *   - connectionString  required, must start with `nostr+walletconnect://`
 *   - mode              optional, RECEIVE | SEND_RECEIVE, default RECEIVE
 *   - isPrimary         optional, default false
 *
 * De-dupes on `(userId, connectionString)` — re-submitting the same URI
 * returns the existing row as 200 rather than a 409, so a retry after a
 * flaky network doesn't fabricate a duplicate. Emits the same
 * `addresses:updated` bus event the address routes use so connected SSE
 * clients refetch their address list (since the derived `nwcMode` per
 * address depends on the primary connection).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const { pubkey } = await authenticate(request)
  const { connectionString, mode, isPrimary } = await validateBody(
    request,
    createNwcConnectionSchema,
  )

  // Best-effort structural validation — rejects URIs that don't parse out to
  // the two required pieces (remote pubkey + at least one relay). Runtime
  // reachability is the listener's concern.
  const parsed = parseNwc(connectionString)
  if (!parsed || !parsed.pubkey || parsed.relays.length === 0) {
    throw new ConflictError('Not a valid NWC connection string')
  }

  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new AuthenticationError('User not found')

  const existing = await prisma.nWCConnection.findFirst({
    where: { userId: user.id, connectionString },
  })
  if (existing) {
    return NextResponse.json<WalletNwcConnectionSummaryDto>({
      id: existing.id,
      mode: existing.mode,
      isPrimary: existing.isPrimary,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: existing.updatedAt.toISOString(),
    })
  }

  // If the caller asked to mark this connection primary, first clear the
  // previous primary in the same transaction — the schema doesn't enforce
  // "one primary per user" (we considered a partial unique index but opted
  // out to keep migrations hand-free), so we enforce it in code.
  const created = await prisma.$transaction(async tx => {
    if (isPrimary) {
      await tx.nWCConnection.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      })
    }
    return tx.nWCConnection.create({
      data: {
        userId: user.id,
        connectionString,
        mode: mode ?? 'RECEIVE',
        isPrimary: isPrimary ?? false,
      },
    })
  })

  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })

  logActivity.fireAndForget({
    category: 'NWC',
    event: ActivityEvent.NWC_CONNECTION_CREATED,
    message: `NWC connection added (mode=${created.mode}${created.isPrimary ? ', primary' : ''})`,
    userId: user.id,
    metadata: { connectionId: created.id, mode: created.mode, isPrimary: created.isPrimary },
  })

  if (created.isPrimary) {
    logActivity.fireAndForget({
      category: 'NWC',
      event: ActivityEvent.NWC_DEFAULT_CHANGED,
      message: `Default NWC connection changed`,
      userId: user.id,
      metadata: { connectionId: created.id },
    })
  }

  return NextResponse.json<WalletNwcConnectionSummaryDto>(
    {
      id: created.id,
      mode: created.mode,
      isPrimary: created.isPrimary,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
    { status: 201 },
  )
})
